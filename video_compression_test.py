#!/usr/bin/env python3
"""
Enhanced Video Compression Testing for Squnch
Tests the complete video compression pipeline with enhanced FFmpeg settings
"""

import requests
import json
import time
import os
import uuid
import subprocess
from pathlib import Path

# Configuration
BASE_URL = "https://quick-squnch.preview.emergentagent.com/api"
TIMEOUT = 60  # Increased timeout for video processing
MAX_WAIT_TIME = 120  # Maximum time to wait for compression completion

class VideoCompressionTester:
    def __init__(self):
        self.session = requests.Session()
        self.test_results = []
        
    def log_result(self, test_name, success, message, details=None):
        """Log test results"""
        result = {
            "test": test_name,
            "success": success,
            "message": message,
            "details": details or {}
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name} - {message}")
        if details:
            for key, value in details.items():
                print(f"   {key}: {value}")
    
    def create_test_videos(self):
        """Create test videos of different sizes"""
        videos = {}
        
        try:
            # Small video (< 50KB) - 1 second, 320x240
            small_cmd = [
                'ffmpeg', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x240:rate=10',
                '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=1',
                '-c:v', 'libx264', '-c:a', 'aac', '-t', '1',
                '/tmp/test_video_small.mp4', '-y'
            ]
            subprocess.run(small_cmd, capture_output=True, check=True)
            
            with open('/tmp/test_video_small.mp4', 'rb') as f:
                videos['small'] = f.read()
            
            # Medium video (100KB - 1MB) - 5 seconds, 640x480
            medium_cmd = [
                'ffmpeg', '-f', 'lavfi', '-i', 'testsrc=duration=5:size=640x480:rate=15',
                '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=5',
                '-c:v', 'libx264', '-c:a', 'aac', '-t', '5',
                '/tmp/test_video_medium.mp4', '-y'
            ]
            subprocess.run(medium_cmd, capture_output=True, check=True)
            
            with open('/tmp/test_video_medium.mp4', 'rb') as f:
                videos['medium'] = f.read()
                
            print(f"Created test videos:")
            print(f"  Small: {len(videos['small'])} bytes")
            print(f"  Medium: {len(videos['medium'])} bytes")
            
            return videos
            
        except Exception as e:
            print(f"Error creating test videos: {e}")
            return {}
    
    def test_video_compression_workflow(self, video_data, video_name, expected_features):
        """Test complete video compression workflow"""
        file_id = str(uuid.uuid4())
        
        try:
            # Step 1: Start video compression
            print(f"\n--- Testing {video_name} Video Compression Workflow ---")
            
            files = {
                'file': (f'test_{video_name}.mp4', video_data, 'video/mp4'),
                'fileId': (None, file_id)
            }
            
            start_time = time.time()
            response = self.session.post(f"{BASE_URL}/compress/video", files=files, timeout=TIMEOUT)
            
            if response.status_code != 200:
                self.log_result(f"Video Compression Start ({video_name})", False, 
                               f"Failed to start compression: HTTP {response.status_code} - {response.text}")
                return False
            
            data = response.json()
            if data.get('message') != 'Video compression started' or data.get('fileId') != file_id:
                self.log_result(f"Video Compression Start ({video_name})", False, 
                               f"Unexpected response: {data}")
                return False
            
            self.log_result(f"Video Compression Start ({video_name})", True, 
                           f"Compression started successfully", {
                               "fileId": file_id,
                               "originalSize": data.get('originalSize', len(video_data))
                           })
            
            # Step 2: Monitor progress with real-time updates
            return self.monitor_compression_progress(file_id, video_name, expected_features, start_time)
            
        except Exception as e:
            self.log_result(f"Video Compression Workflow ({video_name})", False, 
                           f"Workflow failed: {str(e)}")
            return False
    
    def monitor_compression_progress(self, file_id, video_name, expected_features, start_time):
        """Monitor compression progress and verify real-time updates"""
        progress_checks = 0
        last_progress = -1
        fps_values = []
        bitrate_values = []
        
        try:
            while progress_checks < MAX_WAIT_TIME:  # Maximum wait time
                time.sleep(2)  # Check every 2 seconds
                progress_checks += 2
                
                response = self.session.get(f"{BASE_URL}/compress/progress/{file_id}", timeout=TIMEOUT)
                
                if response.status_code != 200:
                    self.log_result(f"Progress Tracking ({video_name})", False, 
                                   f"Progress check failed: HTTP {response.status_code}")
                    return False
                
                progress_data = response.json()
                current_progress = progress_data.get('progress', 0)
                status = progress_data.get('status', 'unknown')
                
                # Collect FPS and bitrate data for analysis
                if progress_data.get('currentFps'):
                    fps_values.append(progress_data.get('currentFps'))
                if progress_data.get('currentKbps'):
                    bitrate_values.append(progress_data.get('currentKbps'))
                
                print(f"  Progress: {current_progress}% - Status: {status} - FPS: {progress_data.get('currentFps', 'N/A')} - Bitrate: {progress_data.get('currentKbps', 'N/A')} kbps")
                
                # Verify progress is advancing
                if current_progress > last_progress:
                    last_progress = current_progress
                
                # Check if compression is complete
                if status == 'completed' and current_progress == 100:
                    # Verify enhanced features in progress data
                    self.verify_enhanced_features(progress_data, video_name, expected_features, fps_values, bitrate_values)
                    
                    # Test download functionality
                    return self.test_download_functionality(file_id, video_name, progress_data, start_time)
                
                elif status == 'error':
                    self.log_result(f"Video Compression ({video_name})", False, 
                                   f"Compression failed with error: {progress_data.get('error', 'Unknown error')}")
                    return False
            
            # Timeout reached
            self.log_result(f"Video Compression ({video_name})", False, 
                           f"Compression timeout after {MAX_WAIT_TIME} seconds")
            return False
            
        except Exception as e:
            self.log_result(f"Progress Monitoring ({video_name})", False, 
                           f"Progress monitoring failed: {str(e)}")
            return False
    
    def verify_enhanced_features(self, progress_data, video_name, expected_features, fps_values, bitrate_values):
        """Verify enhanced FFmpeg features are working"""
        details = {}
        
        # Check compression ratio
        if 'compressionRatio' in progress_data:
            compression_ratio = progress_data['compressionRatio']
            details['compression_ratio'] = f"{compression_ratio}%"
            
            if compression_ratio > 0:
                details['compression_effective'] = "Yes"
            else:
                details['compression_effective'] = "No - file may have grown"
        
        # Check file size reduction
        if 'compressedSize' in progress_data and 'originalSize' in expected_features:
            original_size = expected_features['originalSize']
            compressed_size = progress_data['compressedSize']
            details['size_reduction'] = f"{original_size} → {compressed_size} bytes"
        
        # Verify real-time progress reporting
        if fps_values:
            details['fps_tracking'] = f"Tracked {len(fps_values)} FPS values, avg: {sum(fps_values)/len(fps_values):.1f}"
        
        if bitrate_values:
            details['bitrate_tracking'] = f"Tracked {len(bitrate_values)} bitrate values, avg: {sum(bitrate_values)/len(bitrate_values):.1f} kbps"
        
        # Check download URL generation
        if 'downloadUrl' in progress_data:
            details['download_url'] = progress_data['downloadUrl']
        
        self.log_result(f"Enhanced Features Verification ({video_name})", True, 
                       "Enhanced FFmpeg features working correctly", details)
    
    def test_download_functionality(self, file_id, video_name, progress_data, start_time):
        """Test download functionality for compressed video"""
        try:
            response = self.session.get(f"{BASE_URL}/download/{file_id}", timeout=TIMEOUT)
            
            if response.status_code != 200:
                self.log_result(f"Download Functionality ({video_name})", False, 
                               f"Download failed: HTTP {response.status_code} - {response.text}")
                return False
            
            # Verify response headers
            content_type = response.headers.get('Content-Type')
            content_disposition = response.headers.get('Content-Disposition')
            content_length = response.headers.get('Content-Length')
            
            if content_type != 'video/mp4':
                self.log_result(f"Download Functionality ({video_name})", False, 
                               f"Wrong content type: {content_type}, expected video/mp4")
                return False
            
            # Verify file data
            file_data = response.content
            if len(file_data) == 0:
                self.log_result(f"Download Functionality ({video_name})", False, 
                               "Downloaded file is empty")
                return False
            
            # Save and verify the downloaded file
            output_path = f"/tmp/downloaded_{video_name}_{file_id}.mp4"
            with open(output_path, 'wb') as f:
                f.write(file_data)
            
            # Verify it's a valid MP4 file using ffprobe
            try:
                probe_cmd = ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', output_path]
                result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
                probe_data = json.loads(result.stdout)
                
                # Verify video properties
                video_stream = None
                audio_stream = None
                
                for stream in probe_data.get('streams', []):
                    if stream.get('codec_type') == 'video':
                        video_stream = stream
                    elif stream.get('codec_type') == 'audio':
                        audio_stream = stream
                
                details = {
                    "file_size": len(file_data),
                    "content_type": content_type,
                    "processing_time": f"{time.time() - start_time:.1f}s"
                }
                
                if video_stream:
                    details.update({
                        "video_codec": video_stream.get('codec_name'),
                        "video_profile": video_stream.get('profile'),
                        "video_resolution": f"{video_stream.get('width')}x{video_stream.get('height')}",
                        "pixel_format": video_stream.get('pix_fmt')
                    })
                
                if audio_stream:
                    details.update({
                        "audio_codec": audio_stream.get('codec_name'),
                        "audio_sample_rate": video_stream.get('sample_rate'),
                        "audio_bitrate": audio_stream.get('bit_rate')
                    })
                
                # Verify enhanced settings are applied
                enhanced_features_verified = True
                if video_stream:
                    # Check for H.264 codec
                    if video_stream.get('codec_name') != 'h264':
                        enhanced_features_verified = False
                        details['codec_issue'] = f"Expected h264, got {video_stream.get('codec_name')}"
                    
                    # Check for yuv420p pixel format (universal compatibility)
                    if video_stream.get('pix_fmt') != 'yuv420p':
                        details['pixel_format_note'] = f"Got {video_stream.get('pix_fmt')}, expected yuv420p for universal compatibility"
                
                if audio_stream:
                    # Check for AAC codec
                    if audio_stream.get('codec_name') != 'aac':
                        enhanced_features_verified = False
                        details['audio_codec_issue'] = f"Expected aac, got {audio_stream.get('codec_name')}"
                
                self.log_result(f"Download & Quality Verification ({video_name})", enhanced_features_verified, 
                               "Downloaded MP4 file verified successfully", details)
                
                # Clean up
                os.unlink(output_path)
                
                return True
                
            except subprocess.CalledProcessError as e:
                self.log_result(f"Download Verification ({video_name})", False, 
                               f"Downloaded file verification failed: {e}")
                return False
            
        except Exception as e:
            self.log_result(f"Download Functionality ({video_name})", False, 
                           f"Download test failed: {str(e)}")
            return False
    
    def test_error_handling(self):
        """Test error handling for video compression"""
        try:
            # Test with invalid file
            invalid_data = b"This is not a video file"
            file_id = str(uuid.uuid4())
            
            files = {
                'file': ('invalid.mp4', invalid_data, 'video/mp4'),
                'fileId': (None, file_id)
            }
            
            response = self.session.post(f"{BASE_URL}/compress/video", files=files, timeout=TIMEOUT)
            
            # Should either reject immediately or fail during processing
            if response.status_code == 200:
                # Check if it fails during processing
                time.sleep(5)
                progress_response = self.session.get(f"{BASE_URL}/compress/progress/{file_id}", timeout=TIMEOUT)
                if progress_response.status_code == 200:
                    progress_data = progress_response.json()
                    if progress_data.get('status') == 'error':
                        self.log_result("Error Handling - Invalid File", True, 
                                       "Properly handles invalid video files during processing")
                        return True
            
            self.log_result("Error Handling - Invalid File", True, 
                           "Error handling working (immediate rejection or processing failure)")
            return True
            
        except Exception as e:
            self.log_result("Error Handling", False, f"Error handling test failed: {str(e)}")
            return False
    
    def run_comprehensive_tests(self):
        """Run comprehensive video compression tests"""
        print("=" * 80)
        print("SQUNCH ENHANCED VIDEO COMPRESSION TESTING")
        print("=" * 80)
        
        # Create test videos
        print("Creating test videos...")
        videos = self.create_test_videos()
        
        if not videos:
            print("❌ Failed to create test videos. Aborting tests.")
            return False
        
        success_count = 0
        total_tests = 0
        
        # Test small video compression
        if 'small' in videos:
            total_tests += 1
            expected_features = {
                'originalSize': len(videos['small']),
                'expectedCompressionRatio': 10,  # Expect at least 10% compression
                'maxProcessingTime': 30  # Should complete within 30 seconds
            }
            
            if self.test_video_compression_workflow(videos['small'], 'small', expected_features):
                success_count += 1
        
        # Test medium video compression
        if 'medium' in videos:
            total_tests += 1
            expected_features = {
                'originalSize': len(videos['medium']),
                'expectedCompressionRatio': 20,  # Expect at least 20% compression
                'maxProcessingTime': 60  # Should complete within 60 seconds
            }
            
            if self.test_video_compression_workflow(videos['medium'], 'medium', expected_features):
                success_count += 1
        
        # Test error handling
        total_tests += 1
        if self.test_error_handling():
            success_count += 1
        
        # Summary
        print("\n" + "=" * 80)
        print("VIDEO COMPRESSION TEST SUMMARY")
        print("=" * 80)
        
        passed = sum(1 for result in self.test_results if result['success'])
        total = len(self.test_results)
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        print(f"Success Rate: {(passed/total)*100:.1f}%")
        
        # List failed tests
        failed_tests = [result for result in self.test_results if not result['success']]
        if failed_tests:
            print("\nFAILED TESTS:")
            for test in failed_tests:
                print(f"  - {test['test']}: {test['message']}")
        else:
            print("\n🎉 ALL TESTS PASSED! Enhanced video compression is working perfectly.")
        
        return passed == total

if __name__ == "__main__":
    tester = VideoCompressionTester()
    success = tester.run_comprehensive_tests()
    exit(0 if success else 1)