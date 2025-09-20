import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import ffmpeg from 'fluent-ffmpeg'

// MongoDB connection
let client
let db

async function connectToMongo() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URL)
    await client.connect()
    db = client.db(process.env.DB_NAME)
  }
  return db
}

// Helper function to handle CORS
function handleCORS(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

// OPTIONS handler for CORS
export async function OPTIONS() {
  return handleCORS(new NextResponse(null, { status: 200 }))
}

// Helper function to ensure temp directory exists
async function ensureTempDir() {
  const tempDir = path.join(os.tmpdir(), 'squnch')
  try {
    await fs.access(tempDir)
  } catch {
    await fs.mkdir(tempDir, { recursive: true })
  }
  return tempDir
}

// Helper function to get file from multipart form data
async function getFileFromFormData(request) {
  try {
    console.log('Parsing form data...')
    const formData = await request.formData()
    const file = formData.get('file')
    const fileId = formData.get('fileId')
    
    console.log('File info:', {
      hasFile: !!file,
      fileName: file?.name,
      fileSize: file?.size,
      fileType: file?.type,
      fileId
    })
    
    if (!file) {
      throw new Error('No file provided')
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    
    console.log('Buffer created, size:', buffer.length)

    return { file: buffer, fileName: file.name, fileId, mimeType: file.type }
  } catch (error) {
    console.error('Form data parsing error:', error)
    throw new Error(`Failed to parse form data: ${error.message}`)
  }
}

// Image compression function
async function compressImage(buffer, fileName, quality = 85) {
  try {
    const fileExt = path.extname(fileName).toLowerCase()
    let compressedBuffer

    // Handle different image formats
    if (fileExt === '.png') {
      compressedBuffer = await sharp(buffer)
        .png({ quality, progressive: true, compressionLevel: 9 })
        .toBuffer()
    } else if (fileExt === '.webp') {
      compressedBuffer = await sharp(buffer)
        .webp({ quality, effort: 6 })
        .toBuffer()
    } else {
      // Default to JPEG for other formats
      compressedBuffer = await sharp(buffer)
        .jpeg({ quality, progressive: true, mozjpeg: true })
        .toBuffer()
    }

    return compressedBuffer
  } catch (error) {
    throw new Error(`Image compression failed: ${error.message}`)
  }
}

// Enhanced video compression function optimized for content creators
async function compressVideo(inputPath, outputPath, fileId, originalSize) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await connectToMongo()
      
      // Set FFmpeg paths explicitly
      ffmpeg.setFfmpegPath('/usr/bin/ffmpeg')
      ffmpeg.setFfprobePath('/usr/bin/ffprobe')
      
      console.log(`Starting video compression for fileId: ${fileId}`)
      console.log(`Input: ${inputPath}, Output: ${outputPath}`)
      
      // Initialize progress tracking
      await database.collection('compression_progress').replaceOne(
        { fileId },
        {
          fileId,
          status: 'processing',
          progress: 0,
          startTime: new Date(),
          originalSize
        },
        { upsert: true }
      )
      
      // Content creator optimized settings for quality
      const command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          // High quality preset for content creators
          '-preset slow',          // Better compression, slower encoding
          '-crf 20',              // High quality (18-23 range, lower = better quality)
          '-profile:v high',      // H.264 High Profile for better compression
          '-level 4.1',           // Compatible with most devices
          '-movflags +faststart', // Web streaming optimization
          '-pix_fmt yuv420p',     // Universal compatibility
          // Audio optimization
          '-b:a 192k',            // Higher audio bitrate for creators
          '-ar 48000',            // Professional audio sample rate
          // Optimization for social media
          '-maxrate 8000k',       // Maximum bitrate cap
          '-bufsize 16000k',      // Buffer size for rate control
          '-g 48',                // GOP size for seeking
          '-keyint_min 48',       // Minimum keyframe interval
          '-sc_threshold 0'       // Disable scene change detection
        ])
      
      // Add scaling if video is very large (optimize for web)
      command.videoFilters([
        'scale=\'min(1920,iw)\':\'min(1080,ih)\':force_original_aspect_ratio=decrease',
        'pad=ceil(iw/2)*2:ceil(ih/2)*2'
      ])
      
      command
        .on('start', async (commandLine) => {
          console.log('FFmpeg command:', commandLine)
          try {
            await database.collection('compression_progress').updateOne(
              { fileId },
              { $set: { status: 'processing', commandLine } }
            )
          } catch (error) {
            console.error('Failed to update start status:', error)
          }
        })
        .on('progress', async (progress) => {
          try {
            const progressPercent = Math.min(Math.round(progress.percent || 0), 99)
            console.log(`Video compression progress: ${progressPercent}% - ${progress.currentFps || 0} fps - ${progress.currentKbps || 0} kbps`)
            
            await database.collection('compression_progress').updateOne(
              { fileId },
              {
                $set: {
                  progress: progressPercent,
                  status: 'processing',
                  currentFps: progress.currentFps,
                  currentKbps: progress.currentKbps,
                  processedTime: progress.timemark
                }
              }
            )
          } catch (error) {
            console.error('Failed to update progress:', error)
          }
        })
        .on('end', async () => {
          try {
            console.log('Video compression completed successfully')
            const stats = await fs.stat(outputPath)
            const compressedSize = stats.size
            const compressionRatio = Math.round((1 - compressedSize / originalSize) * 100)
            
            console.log(`Compression results: ${originalSize} -> ${compressedSize} bytes (${compressionRatio}% reduction)`)
            
            await database.collection('compression_progress').updateOne(
              { fileId },
              {
                $set: {
                  status: 'completed',
                  progress: 100,
                  compressedSize,
                  compressionRatio,
                  endTime: new Date(),
                  downloadUrl: `/api/download/${fileId}`
                }
              }
            )
            
            resolve({
              compressedSize,
              compressionRatio,
              originalSize
            })
          } catch (error) {
            console.error('Error in completion handler:', error)
            reject(error)
          }
        })
        .on('error', async (error) => {
          console.error('FFmpeg compression error:', error)
          try {
            await database.collection('compression_progress').updateOne(
              { fileId },
              {
                $set: {
                  status: 'error',
                  error: error.message,
                  endTime: new Date()
                }
              }
            )
          } catch (dbError) {
            console.error('Failed to update error status:', dbError)
          }
          
          // Clean up files on error
          try {
            await fs.unlink(inputPath).catch(() => {})
            await fs.unlink(outputPath).catch(() => {})
          } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError)
          }
          
          reject(error)
        })
        .save(outputPath)
        
    } catch (error) {
      console.error('Video compression setup error:', error)
      
      // Update error status in database
      try {
        const database = await connectToMongo()
        await database.collection('compression_progress').updateOne(
          { fileId },
          {
            $set: {
              status: 'error',
              error: error.message,
              endTime: new Date()
            }
          },
          { upsert: true }
        )
      } catch (dbError) {
        console.error('Failed to update setup error status:', dbError)
      }
      
      reject(error)
    }
  })
}

// Route handler function
async function handleRoute(request, { params }) {
  const { path: routePath = [] } = params || {}
  const route = `/${(routePath || []).join('/')}`
  const method = request.method

  try {
    const db = await connectToMongo()

    // Root endpoint
    if (route === '/' && method === 'GET') {
      return handleCORS(NextResponse.json({ message: "Squnch API Ready" }))
    }

    // Image compression endpoint
    if (route === '/compress/image' && method === 'POST') {
      try {
        const { file: buffer, fileName, fileId } = await getFileFromFormData(request)
        
        // Compress image
        const compressedBuffer = await compressImage(buffer, fileName)
        
        // Return compressed image
        return handleCORS(new NextResponse(compressedBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="compressed_${fileName}"`,
            'Content-Length': compressedBuffer.length.toString()
          }
        }))
      } catch (error) {
        console.error('Image compression error:', error)
        return handleCORS(NextResponse.json(
          { error: error.message },
          { status: 500 }
        ))
      }
    }

    // Video compression endpoint
    if (route === '/compress/video' && method === 'POST') {
      try {
        console.log('Video compression endpoint called')
        const { file: buffer, fileName, fileId } = await getFileFromFormData(request)
        
        console.log(`Processing video: ${fileName}, size: ${buffer.length} bytes, fileId: ${fileId}`)
        
        const tempDir = await ensureTempDir()
        const fileExt = path.extname(fileName).toLowerCase()
        const inputPath = path.join(tempDir, `input_${fileId}${fileExt}`)
        const outputPath = path.join(tempDir, `output_${fileId}.mp4`)
        
        // Write input file
        await fs.writeFile(inputPath, buffer)
        console.log(`Input file written to: ${inputPath}`)
        
        // Start compression with enhanced function
        compressVideo(inputPath, outputPath, fileId, buffer.length)
          .then(async (result) => {
            console.log('Video compression completed:', result)
            // Input file cleanup is handled in the compression function
          })
          .catch(async (error) => {
            console.error('Video compression failed:', error)
            // Cleanup is handled in the compression function
          })
        
        return handleCORS(NextResponse.json({ 
          message: 'Video compression started',
          fileId,
          originalSize: buffer.length
        }))
      } catch (error) {
        console.error('Video compression endpoint error:', error)
        return handleCORS(NextResponse.json(
          { error: error.message },
          { status: 500 }
        ))
      }
    }

    // Progress check endpoint
    if (route.startsWith('/compress/progress/') && method === 'GET') {
      const fileId = route.split('/').pop()
      
      try {
        const progress = await db.collection('compression_progress').findOne({ fileId })
        
        if (!progress) {
          return handleCORS(NextResponse.json(
            { error: 'Progress not found' },
            { status: 404 }
          ))
        }

        return handleCORS(NextResponse.json(progress))
      } catch (error) {
        console.error('Progress check error:', error)
        return handleCORS(NextResponse.json(
          { error: error.message },
          { status: 500 }
        ))
      }
    }

    // Download endpoint
    if (route.startsWith('/download/') && method === 'GET') {
      const fileId = route.split('/').pop()
      
      try {
        console.log(`Download request for fileId: ${fileId}`)
        const progress = await db.collection('compression_progress').findOne({ fileId })
        
        if (!progress) {
          console.log(`Progress not found for fileId: ${fileId}`)
          return handleCORS(NextResponse.json(
            { error: 'File not found' },
            { status: 404 }
          ))
        }

        if (progress.status !== 'completed') {
          console.log(`File not ready for download, status: ${progress.status}`)
          return handleCORS(NextResponse.json(
            { error: `File not ready for download. Status: ${progress.status}` },
            { status: 404 }
          ))
        }

        const tempDir = await ensureTempDir()
        
        // Look for output file with .mp4 extension (standardized output)
        const outputPath = path.join(tempDir, `output_${fileId}.mp4`)
        
        try {
          await fs.access(outputPath)
        } catch {
          console.log(`Output file not found: ${outputPath}`)
          return handleCORS(NextResponse.json(
            { error: 'Compressed file not found' },
            { status: 404 }
          ))
        }

        const fileBuffer = await fs.readFile(outputPath)
        console.log(`Serving compressed video: ${fileBuffer.length} bytes`)
        
        // Clean up file after successful read (but keep it for a few minutes for multiple downloads)
        setTimeout(() => {
          fs.unlink(outputPath).catch(console.error)
        }, 5 * 60 * 1000) // 5 minutes delay
        
        const fileName = `compressed_video_${fileId}.mp4`
        
        return handleCORS(new NextResponse(fileBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': fileBuffer.length.toString()
          }
        }))
      } catch (error) {
        console.error('Download error:', error)
        return handleCORS(NextResponse.json(
          { error: error.message },
          { status: 500 }
        ))
      }
    }

    // Route not found
    return handleCORS(NextResponse.json(
      { error: `Route ${route} not found` },
      { status: 404 }
    ))

  } catch (error) {
    console.error('API Error:', error)
    return handleCORS(NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    ))
  }
}

// Export all HTTP methods
export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute