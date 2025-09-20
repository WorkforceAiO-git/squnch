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

// Video compression function
async function compressVideo(inputPath, outputPath, fileId) {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await connectToMongo()
      
      // Set FFmpeg path explicitly
      ffmpeg.setFfmpegPath('/usr/bin/ffmpeg')
      ffmpeg.setFfprobePath('/usr/bin/ffprobe')
      
      await database.collection('compression_progress').insertOne({
        fileId,
        status: 'processing',
        progress: 0,
        startTime: new Date()
      })
      
      ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .videoBitrate('1000k')
        .audioBitrate('128k')
        .outputOptions([
          '-preset medium',
          '-crf 23',
          '-movflags +faststart',
          '-pix_fmt yuv420p'
        ])
        .on('start', (commandLine) => {
          console.log('FFmpeg process started:', commandLine)
        })
        .on('progress', async (progress) => {
          try {
            const progressPercent = Math.round(progress.percent || 0)
            console.log(`Compression progress: ${progressPercent}%`)
            
            await database.collection('compression_progress').updateOne(
              { fileId },
              {
                $set: {
                  progress: progressPercent,
                  status: 'processing'
                }
              }
            )
          } catch (error) {
            console.error('Failed to update progress:', error)
          }
        })
        .on('end', async () => {
          try {
            console.log('FFmpeg processing finished')
            const stats = await fs.stat(outputPath)
            
            await database.collection('compression_progress').updateOne(
              { fileId },
              {
                $set: {
                  status: 'completed',
                  progress: 100,
                  compressedSize: stats.size,
                  endTime: new Date()
                }
              }
            )
            resolve(stats.size)
          } catch (error) {
            console.error('Error in end handler:', error)
            reject(error)
          }
        })
        .on('error', async (error) => {
          console.error('FFmpeg error:', error)
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
          reject(error)
        })
        .save(outputPath)
        
    } catch (error) {
      console.error('Video compression setup error:', error)
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
        const { file: buffer, fileName, fileId } = await getFileFromFormData(request)
        
        const tempDir = await ensureTempDir()
        const inputPath = path.join(tempDir, `input_${fileId}_${fileName}`)
        const outputPath = path.join(tempDir, `output_${fileId}_${fileName}`)
        
        // Write input file
        await fs.writeFile(inputPath, buffer)
        
        // Start compression (this will run in background)
        compressVideo(inputPath, outputPath, fileId)
          .then(async (compressedSize) => {
            // Calculate compression ratio
            const originalSize = buffer.length
            const compressionRatio = Math.round((1 - compressedSize / originalSize) * 100)
            
            await db.collection('compression_progress').updateOne(
              { fileId },
              {
                $set: {
                  compressionRatio,
                  originalSize,
                  downloadUrl: `/api/download/${fileId}`
                }
              }
            )
            
            // Clean up input file
            fs.unlink(inputPath).catch(console.error)
          })
          .catch(async (error) => {
            console.error('Video compression failed:', error)
            // Clean up files
            fs.unlink(inputPath).catch(console.error)
            fs.unlink(outputPath).catch(console.error)
          })
        
        return handleCORS(NextResponse.json({ 
          message: 'Video compression started',
          fileId 
        }))
      } catch (error) {
        console.error('Video compression error:', error)
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
        const progress = await db.collection('compression_progress').findOne({ fileId })
        
        if (!progress || progress.status !== 'completed') {
          return handleCORS(NextResponse.json(
            { error: 'File not ready for download' },
            { status: 404 }
          ))
        }

        const tempDir = await ensureTempDir()
        const outputPath = path.join(tempDir, `output_${fileId}_*`)
        
        // Find the output file (since we don't store the exact filename)
        const files = await fs.readdir(tempDir)
        const outputFile = files.find(f => f.startsWith(`output_${fileId}_`))
        
        if (!outputFile) {
          return handleCORS(NextResponse.json(
            { error: 'Compressed file not found' },
            { status: 404 }
          ))
        }

        const filePath = path.join(tempDir, outputFile)
        const fileBuffer = await fs.readFile(filePath)
        
        // Clean up file after sending
        fs.unlink(filePath).catch(console.error)
        
        const fileName = outputFile.replace(`output_${fileId}_`, 'compressed_')
        
        return handleCORS(new NextResponse(fileBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
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