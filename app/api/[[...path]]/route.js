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

// Quality preset configurations
const QUALITY_PRESETS = {
  'high-quality': {
    name: 'High Quality',
    description: 'Best quality, larger files',
    image: { quality: 95, format: 'preserve' },
    video: { crf: 18, preset: 'slow', audioBitrate: '192k' }
  },
  'balanced': {
    name: 'Balanced',
    description: 'Great quality, good compression',
    image: { quality: 85, format: 'smart' },
    video: { crf: 23, preset: 'medium', audioBitrate: '128k' }
  },
  'maximum-compression': {
    name: 'Maximum Compression',
    description: 'Smallest files, good quality',
    image: { quality: 75, format: 'smart' },
    video: { crf: 28, preset: 'fast', audioBitrate: '96k' }
  }
}

// Helper function to get file from multipart form data
async function getFileFromFormData(request) {
  try {
    console.log('Parsing form data...')
    const formData = await request.formData()
    const file = formData.get('file')
    const fileId = formData.get('fileId')
    const qualityPreset = formData.get('qualityPreset') || 'balanced'
    const batchId = formData.get('batchId') || null
    
    console.log('File info:', {
      hasFile: !!file,
      fileName: file?.name,
      fileSize: file?.size,
      fileType: file?.type,
      fileId,
      qualityPreset,
      batchId
    })
    
    if (!file) {
      throw new Error('No file provided')
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)
    
    console.log('Buffer created, size:', buffer.length)

    return { 
      file: buffer, 
      fileName: file.name, 
      fileId, 
      mimeType: file.type, 
      qualityPreset,
      batchId
    }
  } catch (error) {
    console.error('Form data parsing error:', error)
    throw new Error(`Failed to parse form data: ${error.message}`)
  }
}

// Smart format conversion logic
function getOptimalFormat(originalFormat, fileSize, qualityPreset) {
  const preset = QUALITY_PRESETS[qualityPreset]
  
  // Only convert if format is set to 'smart'
  if (preset.image.format !== 'smart') {
    return originalFormat === 'image/png' ? 'png' : 'jpeg'
  }
  
  // Smart conversion rules
  if (originalFormat === 'image/png') {
    // Convert PNG to JPEG if file is large and doesn't need transparency
    if (fileSize > 500000) { // 500KB+
      return 'jpeg' // Better compression for photos
    }
    return 'png' // Keep PNG for smaller files
  }
  
  return 'jpeg' // Default to JPEG for other formats
}

// Enhanced image compression function with quality presets
async function compressImage(buffer, fileName, qualityPreset = 'balanced') {
  try {
    const preset = QUALITY_PRESETS[qualityPreset]
    const originalFormat = fileName.toLowerCase().includes('.png') ? 'image/png' : 'image/jpeg'
    const optimalFormat = getOptimalFormat(originalFormat, buffer.length, qualityPreset)
    
    console.log(`Compressing image with ${preset.name} preset, converting to ${optimalFormat}`)
    
    let compressedBuffer
    let outputFormat = optimalFormat

    if (optimalFormat === 'png') {
      compressedBuffer = await sharp(buffer)
        .png({ 
          quality: preset.image.quality, 
          progressive: true, 
          compressionLevel: 9 
        })
        .toBuffer()
    } else {
      compressedBuffer = await sharp(buffer)
        .jpeg({ 
          quality: preset.image.quality, 
          progressive: true, 
          mozjpeg: true,
          optimiseScans: true
        })
        .toBuffer()
    }

    return {
      buffer: compressedBuffer,
      originalFormat,
      outputFormat,
      formatChanged: originalFormat !== `image/${optimalFormat}`
    }
  } catch (error) {
    throw new Error(`Image compression failed: ${error.message}`)
  }
}

// Enhanced video compression function with quality presets
async function compressVideo(inputPath, outputPath, fileId, originalSize, qualityPreset = 'balanced') {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await connectToMongo()
      const preset = QUALITY_PRESETS[qualityPreset]
      
      // Set FFmpeg paths explicitly
      ffmpeg.setFfmpegPath('/usr/bin/ffmpeg')
      ffmpeg.setFfprobePath('/usr/bin/ffprobe')
      
      console.log(`Starting video compression with ${preset.name} preset for fileId: ${fileId}`)
      
      // Initialize progress tracking
      await database.collection('compression_progress').replaceOne(
        { fileId },
        {
          fileId,
          status: 'processing',
          progress: 0,
          startTime: new Date(),
          originalSize,
          qualityPreset,
          presetName: preset.name
        },
        { upsert: true }
      )
      
      // Enhanced settings based on quality preset
      const command = ffmpeg(inputPath)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          `-preset ${preset.video.preset}`,
          `-crf ${preset.video.crf}`,
          '-profile:v high',
          '-level 4.1',
          '-movflags +faststart',
          '-pix_fmt yuv420p',
          `-b:a ${preset.video.audioBitrate}`,
          '-ar 44100',
          '-maxrate 4000k',
          '-bufsize 8000k',
          '-g 30',
          '-keyint_min 30',
          '-sc_threshold 40',
          '-threads 0'
        ])
      
      // Intelligent scaling
      command.videoFilters([
        'scale=\'if(gt(iw,1920),1920,iw)\':\'if(gt(ih,1080),1080,ih)\':force_original_aspect_ratio=decrease',
        'pad=ceil(iw/2)*2:ceil(ih/2)*2:(ow-iw)/2:(oh-ih)/2:color=black'
      ])
      
      command
        .on('start', async (commandLine) => {
          console.log(`FFmpeg command (${preset.name}):`, commandLine)
        })
        .on('progress', async (progress) => {
          try {
            const progressPercent = Math.min(Math.round(progress.percent || 0), 99)
            
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
            const stats = await fs.stat(outputPath)
            const compressedSize = stats.size
            const compressionRatio = Math.round((1 - compressedSize / originalSize) * 100)
            
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
              originalSize,
              qualityPreset
            })
          } catch (error) {
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
          
          // Cleanup
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

    // Quality presets endpoint
    if (route === '/quality-presets' && method === 'GET') {
      return handleCORS(NextResponse.json({ presets: QUALITY_PRESETS }))
    }

    // Batch processing start endpoint
    if (route === '/batch/start' && method === 'POST') {
      try {
        const body = await request.json()
        const { fileCount, totalSize } = body
        const batchId = uuidv4()
        
        await db.collection('batch_progress').insertOne({
          batchId,
          fileCount,
          totalSize,
          processedFiles: 0,
          totalSaved: 0,
          status: 'processing',
          startTime: new Date(),
          files: []
        })
        
        return handleCORS(NextResponse.json({ batchId }))
      } catch (error) {
        return handleCORS(NextResponse.json({ error: error.message }, { status: 500 }))
      }
    }

    // Batch progress endpoint
    if (route.startsWith('/batch/progress/') && method === 'GET') {
      const batchId = route.split('/').pop()
      
      try {
        const batch = await db.collection('batch_progress').findOne({ batchId })
        
        if (!batch) {
          return handleCORS(NextResponse.json({ error: 'Batch not found' }, { status: 404 }))
        }

        return handleCORS(NextResponse.json(batch))
      } catch (error) {
        return handleCORS(NextResponse.json({ error: error.message }, { status: 500 }))
      }
    }

    // Enhanced image compression endpoint
    if (route === '/compress/image' && method === 'POST') {
      try {
        const { file: buffer, fileName, fileId, qualityPreset, batchId } = await getFileFromFormData(request)
        
        const startTime = Date.now()
        const result = await compressImage(buffer, fileName, qualityPreset)
        const processingTime = Date.now() - startTime
        
        // Track analytics
        const analytics = {
          fileId,
          type: 'image',
          originalSize: buffer.length,
          compressedSize: result.buffer.length,
          compressionRatio: Math.round((1 - result.buffer.length / buffer.length) * 100),
          processingTime,
          qualityPreset,
          originalFormat: result.originalFormat,
          outputFormat: result.outputFormat,
          formatChanged: result.formatChanged,
          timestamp: new Date()
        }
        
        // Store analytics
        await db.collection('analytics').insertOne(analytics)
        
        // Update batch progress if part of batch
        if (batchId) {
          const savedBytes = buffer.length - result.buffer.length
          await db.collection('batch_progress').updateOne(
            { batchId },
            {
              $inc: { 
                processedFiles: 1,
                totalSaved: savedBytes > 0 ? savedBytes : 0
              },
              $push: {
                files: {
                  fileId,
                  fileName,
                  originalSize: buffer.length,
                  compressedSize: result.buffer.length,
                  saved: savedBytes,
                  formatChanged: result.formatChanged
                }
              }
            }
          )
        }
        
        const outputFileName = result.formatChanged ? 
          fileName.replace(/\.[^/.]+$/, `.${result.outputFormat}`) : 
          fileName

        return handleCORS(new NextResponse(result.buffer, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="compressed_${outputFileName}"`,
            'Content-Length': result.buffer.length.toString(),
            'X-Original-Size': buffer.length.toString(),
            'X-Compression-Ratio': analytics.compressionRatio.toString(),
            'X-Format-Changed': result.formatChanged.toString(),
            'X-Processing-Time': processingTime.toString()
          }
        }))
      } catch (error) {
        console.error('Image compression error:', error)
        return handleCORS(NextResponse.json({ error: error.message }, { status: 500 }))
      }
    }

    // Enhanced video compression endpoint
    if (route === '/compress/video' && method === 'POST') {
      try {
        const { file: buffer, fileName, fileId, qualityPreset, batchId } = await getFileFromFormData(request)
        
        const tempDir = await ensureTempDir()
        const fileExt = path.extname(fileName).toLowerCase()
        const inputPath = path.join(tempDir, `input_${fileId}${fileExt}`)
        const outputPath = path.join(tempDir, `output_${fileId}.mp4`)
        
        // Write input file
        await fs.writeFile(inputPath, buffer)
        
        // Start compression with quality preset
        compressVideo(inputPath, outputPath, fileId, buffer.length, qualityPreset)
          .then(async (result) => {
            // Store analytics
            await db.collection('analytics').insertOne({
              fileId,
              type: 'video',
              originalSize: result.originalSize,
              compressedSize: result.compressedSize,
              compressionRatio: result.compressionRatio,
              qualityPreset: result.qualityPreset,
              timestamp: new Date()
            })
            
            // Update batch progress if part of batch
            if (batchId) {
              const savedBytes = result.originalSize - result.compressedSize
              await db.collection('batch_progress').updateOne(
                { batchId },
                {
                  $inc: { 
                    processedFiles: 1,
                    totalSaved: savedBytes > 0 ? savedBytes : 0
                  },
                  $push: {
                    files: {
                      fileId,
                      fileName,
                      originalSize: result.originalSize,
                      compressedSize: result.compressedSize,
                      saved: savedBytes
                    }
                  }
                }
              )
            }
          })
          .catch(console.error)
        
        return handleCORS(NextResponse.json({ 
          message: 'Video compression started',
          fileId,
          originalSize: buffer.length,
          qualityPreset
        }))
      } catch (error) {
        console.error('Video compression endpoint error:', error)
        return handleCORS(NextResponse.json({ error: error.message }, { status: 500 }))
      }
    }

    // Progress check endpoint
    if (route.startsWith('/compress/progress/') && method === 'GET') {
      const fileId = route.split('/').pop()
      
      try {
        const progress = await db.collection('compression_progress').findOne({ fileId })
        
        if (!progress) {
          return handleCORS(NextResponse.json({ error: 'Progress not found' }, { status: 404 }))
        }

        return handleCORS(NextResponse.json(progress))
      } catch (error) {
        console.error('Progress check error:', error)
        return handleCORS(NextResponse.json({ error: error.message }, { status: 500 }))
      }
    }

    // Analytics endpoint
    if (route === '/analytics/summary' && method === 'GET') {
      try {
        const analytics = await db.collection('analytics').aggregate([
          {
            $group: {
              _id: null,
              totalFiles: { $sum: 1 },
              totalOriginalSize: { $sum: '$originalSize' },
              totalCompressedSize: { $sum: '$compressedSize' },
              averageCompressionRatio: { $avg: '$compressionRatio' },
              totalSpaceSaved: { $sum: { $subtract: ['$originalSize', '$compressedSize'] } },
              imageFiles: { $sum: { $cond: [{ $eq: ['$type', 'image'] }, 1, 0] } },
              videoFiles: { $sum: { $cond: [{ $eq: ['$type', 'video'] }, 1, 0] } }
            }
          }
        ]).toArray()

        const summary = analytics[0] || {
          totalFiles: 0,
          totalOriginalSize: 0,
          totalCompressedSize: 0,
          averageCompressionRatio: 0,
          totalSpaceSaved: 0,
          imageFiles: 0,
          videoFiles: 0
        }

        return handleCORS(NextResponse.json(summary))
      } catch (error) {
        return handleCORS(NextResponse.json({ error: error.message }, { status: 500 }))
      }
    }

    // Download endpoint
    if (route.startsWith('/download/') && method === 'GET') {
      const fileId = route.split('/').pop()
      
      try {
        const progress = await db.collection('compression_progress').findOne({ fileId })
        
        if (!progress || progress.status !== 'completed') {
          return handleCORS(NextResponse.json(
            { error: `File not ready for download. Status: ${progress?.status || 'not found'}` },
            { status: 404 }
          ))
        }

        const tempDir = await ensureTempDir()
        const outputPath = path.join(tempDir, `output_${fileId}.mp4`)
        
        try {
          await fs.access(outputPath)
        } catch {
          return handleCORS(NextResponse.json({ error: 'Compressed file not found' }, { status: 404 }))
        }

        const fileBuffer = await fs.readFile(outputPath)
        
        setTimeout(() => {
          fs.unlink(outputPath).catch(console.error)
        }, 5 * 60 * 1000) // 5 minutes delay
        
        const fileName = `compressed_video_${fileId}.mp4`
        
        return handleCORS(new NextResponse(fileBuffer, {
          status: 200,
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Disposition': `attachment; filename="${fileName}"`,
            'Content-Length': fileBuffer.length.toString(),
            'X-Original-Size': progress.originalSize?.toString() || '0',
            'X-Compression-Ratio': progress.compressionRatio?.toString() || '0',
            'X-Quality-Preset': progress.qualityPreset || 'balanced'
          }
        }))
      } catch (error) {
        console.error('Download error:', error)
        return handleCORS(NextResponse.json({ error: error.message }, { status: 500 }))
      }
    }

    // Route not found
    return handleCORS(NextResponse.json({ error: `Route ${route} not found` }, { status: 404 }))

  } catch (error) {
    console.error('API Error:', error)
    return handleCORS(NextResponse.json({ error: "Internal server error" }, { status: 500 }))
  }
}

// Export all HTTP methods
export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute