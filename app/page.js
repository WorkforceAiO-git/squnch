'use client'

import { useState, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Upload, File, Image, Video, Download, X, CheckCircle, Loader2 } from 'lucide-react'

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'image/tiff', 'image/gif', 'image/bmp']
const SUPPORTED_VIDEO_TYPES = ['video/mp4', 'video/mov', 'video/avi', 'video/mkv', 'video/webm']
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024 // 2GB

export default function Squnch() {
  const [files, setFiles] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getFileIcon = (type) => {
    if (SUPPORTED_IMAGE_TYPES.includes(type)) return <Image className="w-6 h-6 text-blue-500" />
    if (SUPPORTED_VIDEO_TYPES.includes(type)) return <Video className="w-6 h-6 text-purple-500" />
    return <File className="w-6 h-6 text-gray-500" />
  }

  const isFileSupported = (type) => {
    return SUPPORTED_IMAGE_TYPES.includes(type) || SUPPORTED_VIDEO_TYPES.includes(type)
  }

  const processFiles = useCallback((fileList) => {
    const newFiles = Array.from(fileList).map(file => {
      if (!isFileSupported(file.type)) {
        return {
          id: Math.random().toString(36).substr(2, 9),
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          status: 'error',
          error: 'Unsupported file type',
          progress: 0
        }
      }

      if (file.size > MAX_FILE_SIZE) {
        return {
          id: Math.random().toString(36).substr(2, 9),
          file,
          name: file.name,
          size: file.size,
          type: file.type,
          status: 'error',
          error: 'File size exceeds 2GB limit',
          progress: 0
        }
      }

      return {
        id: Math.random().toString(36).substr(2, 9),
        file,
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'pending',
        progress: 0,
        originalSize: file.size,
        compressedSize: null,
        compressionRatio: null
      }
    })

    setFiles(prev => [...prev, ...newFiles])

    // Start processing files
    newFiles.forEach(fileObj => {
      if (fileObj.status !== 'error') {
        startCompression(fileObj.id)
      }
    })
  }, [])

  const startCompression = async (fileId) => {
    setFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, status: 'processing', progress: 0 } : f
    ))

    const fileObj = files.find(f => f.id === fileId) || 
                   files.find(f => f.id === fileId) // Fallback

    if (!fileObj) return

    try {
      const formData = new FormData()
      formData.append('file', fileObj.file)
      formData.append('fileId', fileId)

      // Determine compression endpoint based on file type
      const isImage = SUPPORTED_IMAGE_TYPES.includes(fileObj.type)
      const endpoint = isImage ? '/api/compress/image' : '/api/compress/video'

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error(`Compression failed: ${response.statusText}`)
      }

      // Start polling for progress if it's a video
      if (!isImage) {
        pollCompressionProgress(fileId)
      } else {
        // For images, we expect immediate response
        const result = await response.blob()
        const compressedSize = result.size
        const compressionRatio = Math.round((1 - compressedSize / fileObj.originalSize) * 100)

        setFiles(prev => prev.map(f => 
          f.id === fileId ? {
            ...f,
            status: 'completed',
            progress: 100,
            compressedSize,
            compressionRatio,
            compressedBlob: result
          } : f
        ))
      }
    } catch (error) {
      console.error('Compression error:', error)
      setFiles(prev => prev.map(f => 
        f.id === fileId ? { 
          ...f, 
          status: 'error', 
          error: error.message 
        } : f
      ))
    }
  }

  const pollCompressionProgress = async (fileId) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/compress/progress/${fileId}`)
        const data = await response.json()

        if (data.status === 'completed') {
          clearInterval(pollInterval)
          setFiles(prev => prev.map(f => 
            f.id === fileId ? {
              ...f,
              status: 'completed',
              progress: 100,
              compressedSize: data.compressedSize,
              compressionRatio: data.compressionRatio,
              downloadUrl: data.downloadUrl
            } : f
          ))
        } else if (data.status === 'error') {
          clearInterval(pollInterval)
          setFiles(prev => prev.map(f => 
            f.id === fileId ? { 
              ...f, 
              status: 'error', 
              error: data.error 
            } : f
          ))
        } else {
          setFiles(prev => prev.map(f => 
            f.id === fileId ? { 
              ...f, 
              progress: data.progress || f.progress 
            } : f
          ))
        }
      } catch (error) {
        console.error('Progress polling error:', error)
      }
    }, 1000)

    // Cleanup after 30 minutes
    setTimeout(() => clearInterval(pollInterval), 30 * 60 * 1000)
  }

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    if (e.currentTarget.contains(e.relatedTarget)) return
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFiles = e.dataTransfer.files
    if (droppedFiles.length > 0) {
      processFiles(droppedFiles)
    }
  }, [processFiles])

  const handleFileSelect = useCallback((e) => {
    const selectedFiles = e.target.files
    if (selectedFiles.length > 0) {
      processFiles(selectedFiles)
    }
  }, [processFiles])

  const removeFile = (fileId) => {
    setFiles(prev => prev.filter(f => f.id !== fileId))
  }

  const downloadFile = async (fileObj) => {
    try {
      let blob
      if (fileObj.compressedBlob) {
        blob = fileObj.compressedBlob
      } else if (fileObj.downloadUrl) {
        const response = await fetch(fileObj.downloadUrl)
        blob = await response.blob()
      } else {
        throw new Error('No compressed file available')
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `compressed_${fileObj.name}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download error:', error)
    }
  }

  const totalFiles = files.length
  const completedFiles = files.filter(f => f.status === 'completed').length
  const totalSavings = files
    .filter(f => f.status === 'completed' && f.compressedSize)
    .reduce((acc, f) => acc + (f.originalSize - f.compressedSize), 0)

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">S</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Squnch</h1>
            </div>
            <div className="text-sm text-gray-600">
              Professional File Compression
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="py-16 px-6">
        <div className="container mx-auto max-w-4xl text-center">
          <h2 className="text-5xl font-bold text-gray-900 mb-6">
            Compress files without
            <span className="text-primary block">losing quality</span>
          </h2>
          <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto">
            Reduce file sizes by 60-85% with imperceptible quality loss. 
            Built for content creators who demand perfection.
          </p>

          {/* Upload Area */}
          <Card className="mx-auto max-w-2xl">
            <CardContent className="p-8">
              <div
                className={`border-2 border-dashed rounded-xl p-12 text-center transition-all file-upload-area ${
                  isDragging ? 'drag-over' : 'border-gray-200'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  Drop files here or click to browse
                </h3>
                <p className="text-gray-600 mb-4">
                  Support for images and videos up to 2GB
                </p>
                <div className="flex flex-wrap justify-center gap-2 mb-6">
                  <Badge variant="secondary">JPEG</Badge>
                  <Badge variant="secondary">PNG</Badge>
                  <Badge variant="secondary">HEIC</Badge>
                  <Badge variant="secondary">MP4</Badge>
                  <Badge variant="secondary">MOV</Badge>
                  <Badge variant="secondary">AVI</Badge>
                </div>
                <Button 
                  onClick={() => fileInputRef.current?.click()}
                  size="lg"
                  className="bg-primary hover:bg-primary/90"
                >
                  Choose Files
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={[...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_VIDEO_TYPES].join(',')}
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          {totalFiles > 0 && (
            <div className="mt-8 flex justify-center space-x-8">
              <div className="text-center">
                <div className="text-2xl font-bold text-gray-900">{completedFiles}/{totalFiles}</div>
                <div className="text-sm text-gray-600">Files processed</div>
              </div>
              {totalSavings > 0 && (
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{formatFileSize(totalSavings)}</div>
                  <div className="text-sm text-gray-600">Space saved</div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* File List */}
      {files.length > 0 && (
        <section className="py-8 px-6 bg-gray-50">
          <div className="container mx-auto max-w-4xl">
            <h3 className="text-2xl font-bold text-gray-900 mb-6">Processing Files</h3>
            <div className="space-y-4">
              {files.map((fileObj) => (
                <Card key={fileObj.id}>
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4 flex-1 min-w-0">
                        {getFileIcon(fileObj.type)}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <p className="font-medium text-gray-900 truncate">
                              {fileObj.name}
                            </p>
                            {fileObj.status === 'completed' && (
                              <CheckCircle className="w-4 h-4 text-green-500" />
                            )}
                            {fileObj.status === 'processing' && (
                              <Loader2 className="w-4 h-4 text-primary animate-spin" />
                            )}
                          </div>
                          <div className="flex items-center space-x-4 text-sm text-gray-600">
                            <span>{formatFileSize(fileObj.originalSize)}</span>
                            {fileObj.compressedSize && (
                              <>
                                <span>→</span>
                                <span className="text-green-600">
                                  {formatFileSize(fileObj.compressedSize)}
                                </span>
                                <Badge variant="outline" className="text-green-600">
                                  -{fileObj.compressionRatio}%
                                </Badge>
                              </>
                            )}
                          </div>
                          {fileObj.status === 'processing' && (
                            <Progress value={fileObj.progress} className="mt-2" />
                          )}
                          {fileObj.status === 'error' && (
                            <p className="text-red-500 text-sm mt-1">{fileObj.error}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center space-x-2">
                        {fileObj.status === 'completed' && (
                          <Button
                            onClick={() => downloadFile(fileObj)}
                            size="sm"
                            variant="outline"
                          >
                            <Download className="w-4 h-4 mr-2" />
                            Download
                          </Button>
                        )}
                        <Button
                          onClick={() => removeFile(fileObj.id)}
                          size="sm"
                          variant="ghost"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="py-12 px-6 bg-white border-t">
        <div className="container mx-auto max-w-4xl text-center">
          <p className="text-gray-600">
            Built for content creators who demand perfection.
          </p>
        </div>
      </footer>
    </div>
  )
}