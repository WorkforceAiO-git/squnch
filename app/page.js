'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Upload, File, Image, Video, Download, X, CheckCircle, Loader2, Trophy, Zap, Star, TrendingUp, BarChart3, Sparkles } from 'lucide-react'

const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'image/tiff', 'image/gif', 'image/bmp']
const SUPPORTED_VIDEO_TYPES = ['video/mp4', 'video/mov', 'video/avi', 'video/mkv', 'video/webm']
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024 // 2GB

const QUALITY_PRESETS = {
  'high-quality': {
    name: 'High Quality',
    description: 'Best quality, larger files',
    icon: Star,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 border-blue-200'
  },
  'balanced': {
    name: 'Balanced',
    description: 'Great quality, good compression',
    icon: Zap,
    color: 'text-green-600',
    bgColor: 'bg-green-50 border-green-200'
  },
  'maximum-compression': {
    name: 'Maximum Compression',
    description: 'Smallest files, good quality',
    icon: TrendingUp,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50 border-purple-200'
  }
}

export default function Squnch() {
  const [files, setFiles] = useState([])
  const [isDragging, setIsDragging] = useState(false)
  const [qualityPreset, setQualityPreset] = useState('balanced')
  const [batchMode, setBatchMode] = useState(false)
  const [batchId, setBatchId] = useState(null)
  const [batchProgress, setBatchProgress] = useState(null)
  const [analytics, setAnalytics] = useState(null)
  const [celebrations, setCelebrations] = useState([])
  const [activeTab, setActiveTab] = useState('compress')
  const fileInputRef = useRef(null)

  // Load analytics on component mount
  useEffect(() => {
    loadAnalytics()
  }, [])

  const loadAnalytics = async () => {
    try {
      const response = await fetch('/api/analytics/summary')
      const data = await response.json()
      setAnalytics(data)
    } catch (error) {
      console.error('Failed to load analytics:', error)
    }
  }

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

  const addCelebration = (message, type = 'success') => {
    const celebration = {
      id: Math.random().toString(36).substr(2, 9),
      message,
      type,
      timestamp: Date.now()
    }
    setCelebrations(prev => [celebration, ...prev])
    
    // Remove after 5 seconds
    setTimeout(() => {
      setCelebrations(prev => prev.filter(c => c.id !== celebration.id))
    }, 5000)
  }

  const startBatch = async (fileList) => {
    const totalSize = Array.from(fileList).reduce((sum, file) => sum + file.size, 0)
    
    try {
      const response = await fetch('/api/batch/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileCount: fileList.length,
          totalSize
        })
      })
      
      const { batchId: newBatchId } = await response.json()
      setBatchId(newBatchId)
      setBatchMode(true)
      
      return newBatchId
    } catch (error) {
      console.error('Failed to start batch:', error)
      return null
    }
  }

  const pollBatchProgress = async (batchId) => {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/batch/progress/${batchId}`)
        const data = await response.json()
        
        setBatchProgress(data)
        
        if (data.processedFiles === data.fileCount) {
          clearInterval(pollInterval)
          
          // Celebration for batch completion
          const savedFormatted = formatFileSize(data.totalSaved)
          addCelebration(`🎉 Batch complete! You saved ${savedFormatted} across ${data.fileCount} files!`, 'celebration')
          
          // Reload analytics
          setTimeout(loadAnalytics, 1000)
        }
      } catch (error) {
        console.error('Batch progress polling error:', error)
      }
    }, 1000)

    setTimeout(() => clearInterval(pollInterval), 10 * 60 * 1000) // 10 minutes max
  }

  const processFiles = useCallback(async (fileList) => {
    const fileArray = Array.from(fileList)
    
    // Start batch if multiple files
    let currentBatchId = null
    if (fileArray.length > 1) {
      currentBatchId = await startBatch(fileArray)
      if (currentBatchId) {
        pollBatchProgress(currentBatchId)
      }
    }

    const newFiles = fileArray.map(file => {
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
        compressionRatio: null,
        qualityPreset,
        batchId: currentBatchId
      }
    })

    setFiles(prev => [...prev, ...newFiles])

    // Start processing files
    newFiles.forEach(fileObj => {
      if (fileObj.status !== 'error') {
        startCompression(fileObj.id)
      }
    })
  }, [qualityPreset])

  const startCompression = async (fileId) => {
    setFiles(prev => prev.map(f => 
      f.id === fileId ? { ...f, status: 'processing', progress: 0 } : f
    ))

    const fileObj = files.find(f => f.id === fileId) || 
                   files.find(f => f.id === fileId)

    if (!fileObj) return

    try {
      const formData = new FormData()
      formData.append('file', fileObj.file)
      formData.append('fileId', fileId)
      formData.append('qualityPreset', fileObj.qualityPreset || qualityPreset)
      if (fileObj.batchId) {
        formData.append('batchId', fileObj.batchId)
      }

      const isImage = SUPPORTED_IMAGE_TYPES.includes(fileObj.type)
      const endpoint = isImage ? '/api/compress/image' : '/api/compress/video'

      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        throw new Error(`Compression failed: ${response.statusText}`)
      }

      if (isImage) {
        // For images, we get immediate response
        const result = await response.blob()
        const compressedSize = result.size
        const compressionRatio = Math.round((1 - compressedSize / fileObj.originalSize) * 100)
        
        const formatChanged = response.headers.get('X-Format-Changed') === 'true'
        const processingTime = parseInt(response.headers.get('X-Processing-Time')) || 0

        setFiles(prev => prev.map(f => 
          f.id === fileId ? {
            ...f,
            status: 'completed',
            progress: 100,
            compressedSize,
            compressionRatio,
            compressedBlob: result,
            formatChanged,
            processingTime
          } : f
        ))

        // Individual file celebration
        if (compressionRatio > 0) {
          const savedBytes = fileObj.originalSize - compressedSize
          const savedFormatted = formatFileSize(savedBytes)
          let message = `✨ ${fileObj.name} compressed! Saved ${savedFormatted} (${compressionRatio}%)`
          
          if (formatChanged) {
            message += ` 🔄 Smart format conversion applied!`
          }
          
          addCelebration(message)
        }
      } else {
        // For videos, start polling for progress
        pollCompressionProgress(fileId)
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
              downloadUrl: data.downloadUrl,
              qualityPreset: data.qualityPreset,
              presetName: data.presetName
            } : f
          ))

          // Video completion celebration
          if (data.compressionRatio > 0) {
            const savedBytes = data.originalSize - data.compressedSize
            const savedFormatted = formatFileSize(savedBytes)
            const fileObj = files.find(f => f.id === fileId)
            addCelebration(`🎬 ${fileObj?.name} compressed with ${data.presetName}! Saved ${savedFormatted}`)
          }
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
      
      let downloadName = `compressed_${fileObj.name}`
      if (fileObj.formatChanged) {
        // Change extension for format-converted files
        downloadName = downloadName.replace(/\.[^/.]+$/, '.jpg')
      }
      
      a.download = downloadName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Download error:', error)
    }
  }

  const clearCompleted = () => {
    setFiles(prev => prev.filter(f => f.status !== 'completed'))
    addCelebration('✨ Workspace cleared! Ready for more files.')
  }

  const totalFiles = files.length
  const completedFiles = files.filter(f => f.status === 'completed').length
  const totalSavings = files
    .filter(f => f.status === 'completed' && f.compressedSize)
    .reduce((acc, f) => acc + (f.originalSize - f.compressedSize), 0)

  return (
    <div className="min-h-screen bg-white">
      {/* Celebrations */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {celebrations.map((celebration) => (
          <div
            key={celebration.id}
            className="bg-green-500 text-white px-4 py-2 rounded-lg shadow-lg animate-in slide-in-from-right-5 duration-300"
            style={{ 
              animation: `slideInRight 0.3s ease-out, fadeOut 0.5s ease-in 4.5s forwards` 
            }}
          >
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium">{celebration.message}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Header */}
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-40">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">S</span>
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Squnch</h1>
              <Badge variant="secondary" className="ml-2">Pro</Badge>
            </div>
            
            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-auto">
              <TabsList>
                <TabsTrigger value="compress" className="flex items-center space-x-2">
                  <Zap className="w-4 h-4" />
                  <span>Compress</span>
                </TabsTrigger>
                <TabsTrigger value="analytics" className="flex items-center space-x-2">
                  <BarChart3 className="w-4 h-4" />
                  <span>Analytics</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1">
        <TabsContent value="compress" className="mt-0">
        {/* Hero Section */}
        <section className="py-16 px-6 bg-gradient-to-br from-blue-50 to-purple-50">
          <div className="container mx-auto max-w-4xl text-center">
            <h2 className="text-5xl font-bold text-gray-900 mb-6">
              Compress files without
              <span className="text-primary block">losing quality</span>
            </h2>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Advanced compression with quality presets, batch processing, and smart format conversion.
            </p>

            {/* Quality Preset Selector */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold mb-4">Choose Quality Preset</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mx-auto">
                {Object.entries(QUALITY_PRESETS).map(([key, preset]) => {
                  const IconComponent = preset.icon
                  const isSelected = qualityPreset === key
                  
                  return (
                    <button
                      key={key}
                      onClick={() => setQualityPreset(key)}
                      className={`p-4 border-2 rounded-xl transition-all text-left ${
                        isSelected 
                          ? `${preset.bgColor} border-current ${preset.color}` 
                          : 'bg-white border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-center space-x-3 mb-2">
                        <IconComponent className={`w-5 h-5 ${isSelected ? preset.color : 'text-gray-400'}`} />
                        <span className="font-semibold">{preset.name}</span>
                      </div>
                      <p className="text-sm text-gray-600">{preset.description}</p>
                    </button>
                  )
                })}
              </div>
            </div>

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
                    Support for images and videos up to 2GB • Batch processing available
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
                {batchProgress && (
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">{batchProgress.processedFiles}/{batchProgress.fileCount}</div>
                    <div className="text-sm text-gray-600">Batch progress</div>
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
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-gray-900">Processing Files</h3>
                {completedFiles > 0 && (
                  <Button onClick={clearCompleted} variant="outline" size="sm">
                    Clear Completed
                  </Button>
                )}
              </div>
              
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
                              {fileObj.formatChanged && (
                                <Badge variant="outline" className="text-xs bg-blue-50">
                                  Format Optimized
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center space-x-4 text-sm text-gray-600 mb-2">
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
                              {fileObj.qualityPreset && (
                                <Badge variant="secondary" className="text-xs">
                                  {QUALITY_PRESETS[fileObj.qualityPreset]?.name || fileObj.qualityPreset}
                                </Badge>
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
      </TabsContent>

      <TabsContent value="analytics" className="mt-0">
        <section className="py-16 px-6">
          <div className="container mx-auto max-w-4xl">
            <div className="text-center mb-12">
              <h2 className="text-4xl font-bold text-gray-900 mb-4">Your Compression Analytics</h2>
              <p className="text-xl text-gray-600">See the impact of your optimizations</p>
            </div>

            {analytics && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-600">Total Files Processed</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-gray-900">{analytics.totalFiles}</div>
                    <div className="text-sm text-gray-600 mt-1">
                      {analytics.imageFiles} images • {analytics.videoFiles} videos
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-600">Space Saved</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-green-600">
                      {formatFileSize(analytics.totalSpaceSaved)}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      {((analytics.totalSpaceSaved / analytics.totalOriginalSize) * 100).toFixed(1)}% reduction
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-600">Average Compression</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold text-blue-600">
                      {analytics.averageCompressionRatio?.toFixed(1) || 0}%
                    </div>
                    <div className="text-sm text-gray-600 mt-1">Per file average</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-gray-600">Original vs Compressed</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg font-bold text-gray-900">
                      {formatFileSize(analytics.totalOriginalSize)}
                    </div>
                    <div className="text-sm text-gray-600">↓</div>
                    <div className="text-lg font-bold text-green-600">
                      {formatFileSize(analytics.totalCompressedSize)}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {analytics && analytics.totalFiles > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Trophy className="w-5 h-5 text-yellow-500" />
                    <span>Achievements</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {analytics.totalFiles >= 10 && (
                      <div className="flex items-center space-x-3 p-3 bg-yellow-50 rounded-lg">
                        <Trophy className="w-6 h-6 text-yellow-500" />
                        <div>
                          <div className="font-semibold">Compression Master</div>
                          <div className="text-sm text-gray-600">Processed {analytics.totalFiles} files</div>
                        </div>
                      </div>
                    )}
                    
                    {analytics.totalSpaceSaved > 100 * 1024 * 1024 && (
                      <div className="flex items-center space-x-3 p-3 bg-green-50 rounded-lg">
                        <TrendingUp className="w-6 h-6 text-green-500" />
                        <div>
                          <div className="font-semibold">Space Saver</div>
                          <div className="text-sm text-gray-600">Saved over 100MB</div>
                        </div>
                      </div>
                    )}
                    
                    {analytics.averageCompressionRatio > 50 && (
                      <div className="flex items-center space-x-3 p-3 bg-purple-50 rounded-lg">
                        <Zap className="w-6 h-6 text-purple-500" />
                        <div>
                          <div className="font-semibold">Efficiency Expert</div>
                          <div className="text-sm text-gray-600">{analytics.averageCompressionRatio.toFixed(1)}% avg compression</div>
                        </div>
                      </div>
                    )}
                    
                    {analytics.totalFiles === 0 && (
                      <div className="col-span-2 text-center py-8 text-gray-500">
                        Start compressing files to unlock achievements!
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </section>
      </TabsContent>
      </Tabs>

      {/* Footer */}
      <footer className="py-12 px-6 bg-white border-t">
        <div className="container mx-auto max-w-4xl text-center">
          <p className="text-gray-600">
            Built for content creators who demand perfection.
          </p>
        </div>
      </footer>

      <style jsx>{`
        @keyframes slideInRight {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        
        @keyframes fadeOut {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
            transform: translateX(100%);
          }
        }
      `}</style>
    </div>
  )
}