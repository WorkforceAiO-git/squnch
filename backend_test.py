#!/usr/bin/env python3
"""
Backend API Testing for Squnch File Compression Application
Tests all compression endpoints, progress tracking, and download functionality
"""

import requests
import json
import time
import os
import tempfile
from PIL import Image
import io
import uuid

# Configuration
BASE_URL = "https://quick-squnch.preview.emergentagent.com/api"
TIMEOUT = 30

class SqunchAPITester:
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
            print(f"   Details: {details}")
    
    def create_test_image(self, format='JPEG', size=(800, 600)):
        """Create a test image file"""
        img = Image.new('RGB', size, color='red')
        buffer = io.BytesIO()
        img.save(buffer, format=format)
        buffer.seek(0)
        return buffer.getvalue()
    
    def create_test_video(self):
        """Create a small test video file (mock - using a small binary file)"""
        # Since we can't easily create a real video file, we'll use a small binary file
        # that mimics video data for testing purposes
        video_data = b'\x00\x00\x00\x20ftypmp42\x00\x00\x00\x00mp42isom' + b'\x00' * 1000
        return video_data
    
    def test_api_root(self):
        """Test GET /api endpoint"""
        try:
            response = self.session.get(f"{BASE_URL}", timeout=TIMEOUT)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('message') == "Squnch API Ready":
                    self.log_result("API Root Endpoint", True, "API is ready and responding correctly")
                    return True
                else:
                    self.log_result("API Root Endpoint", False, f"Unexpected response: {data}")
                    return False
            else:
                self.log_result("API Root Endpoint", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("API Root Endpoint", False, f"Request failed: {str(e)}")
            return False
    
    def test_image_compression(self):
        """Test POST /api/compress/image endpoint"""
        try:
            # Test JPEG compression
            jpeg_data = self.create_test_image('JPEG')
            file_id = str(uuid.uuid4())
            
            files = {
                'file': ('test_image.jpg', jpeg_data, 'image/jpeg'),
                'fileId': (None, file_id)
            }
            
            response = self.session.post(f"{BASE_URL}/compress/image", files=files, timeout=TIMEOUT)
            
            if response.status_code == 200:
                # Check if we got compressed image data back
                compressed_data = response.content
                original_size = len(jpeg_data)
                compressed_size = len(compressed_data)
                compression_ratio = (1 - compressed_size / original_size) * 100
                
                details = {
                    "original_size": original_size,
                    "compressed_size": compressed_size,
                    "compression_ratio": f"{compression_ratio:.1f}%",
                    "content_type": response.headers.get('Content-Type')
                }
                
                self.log_result("Image Compression (JPEG)", True, 
                               f"Image compressed successfully ({compression_ratio:.1f}% reduction)", details)
                
                # Test PNG compression
                png_data = self.create_test_image('PNG')
                files = {
                    'file': ('test_image.png', png_data, 'image/png'),
                    'fileId': (None, str(uuid.uuid4()))
                }
                
                response = self.session.post(f"{BASE_URL}/compress/image", files=files, timeout=TIMEOUT)
                if response.status_code == 200:
                    self.log_result("Image Compression (PNG)", True, "PNG compression working")
                    return True
                else:
                    self.log_result("Image Compression (PNG)", False, f"PNG compression failed: {response.status_code}")
                    return False
                    
            else:
                self.log_result("Image Compression", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Image Compression", False, f"Request failed: {str(e)}")
            return False
    
    def test_video_compression_start(self):
        """Test POST /api/compress/video endpoint"""
        try:
            video_data = self.create_test_video()
            file_id = str(uuid.uuid4())
            
            files = {
                'file': ('test_video.mp4', video_data, 'video/mp4'),
                'fileId': (None, file_id)
            }
            
            response = self.session.post(f"{BASE_URL}/compress/video", files=files, timeout=TIMEOUT)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('message') == 'Video compression started' and data.get('fileId') == file_id:
                    self.log_result("Video Compression Start", True, 
                                   f"Video compression started successfully for fileId: {file_id}")
                    return file_id
                else:
                    self.log_result("Video Compression Start", False, f"Unexpected response: {data}")
                    return None
            else:
                self.log_result("Video Compression Start", False, f"HTTP {response.status_code}: {response.text}")
                return None
                
        except Exception as e:
            self.log_result("Video Compression Start", False, f"Request failed: {str(e)}")
            return None
    
    def test_progress_tracking(self, file_id):
        """Test GET /api/compress/progress/{fileId} endpoint"""
        if not file_id:
            self.log_result("Progress Tracking", False, "No fileId provided")
            return False
            
        try:
            response = self.session.get(f"{BASE_URL}/compress/progress/{file_id}", timeout=TIMEOUT)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ['fileId', 'status', 'progress']
                
                if all(field in data for field in required_fields):
                    details = {
                        "fileId": data.get('fileId'),
                        "status": data.get('status'),
                        "progress": data.get('progress'),
                        "startTime": data.get('startTime')
                    }
                    
                    self.log_result("Progress Tracking", True, 
                                   f"Progress tracking working - Status: {data.get('status')}, Progress: {data.get('progress')}%", 
                                   details)
                    return data
                else:
                    self.log_result("Progress Tracking", False, f"Missing required fields in response: {data}")
                    return False
            elif response.status_code == 404:
                self.log_result("Progress Tracking", False, "Progress not found - this might be expected for mock video data")
                return False
            else:
                self.log_result("Progress Tracking", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Progress Tracking", False, f"Request failed: {str(e)}")
            return False
    
    def test_download_endpoint(self, file_id):
        """Test GET /api/download/{fileId} endpoint"""
        if not file_id:
            self.log_result("Download Endpoint", False, "No fileId provided")
            return False
            
        try:
            response = self.session.get(f"{BASE_URL}/download/{file_id}", timeout=TIMEOUT)
            
            if response.status_code == 200:
                # Check if we got file data back
                file_data = response.content
                content_type = response.headers.get('Content-Type')
                content_disposition = response.headers.get('Content-Disposition')
                
                details = {
                    "file_size": len(file_data),
                    "content_type": content_type,
                    "content_disposition": content_disposition
                }
                
                self.log_result("Download Endpoint", True, 
                               f"File download successful - Size: {len(file_data)} bytes", details)
                return True
            elif response.status_code == 404:
                data = response.json()
                self.log_result("Download Endpoint", False, 
                               f"File not ready for download: {data.get('error', 'Unknown error')}")
                return False
            else:
                self.log_result("Download Endpoint", False, f"HTTP {response.status_code}: {response.text}")
                return False
                
        except Exception as e:
            self.log_result("Download Endpoint", False, f"Request failed: {str(e)}")
            return False
    
    def test_error_handling(self):
        """Test error handling for various scenarios"""
        try:
            # Test image compression without file
            response = self.session.post(f"{BASE_URL}/compress/image", timeout=TIMEOUT)
            if response.status_code == 500:
                self.log_result("Error Handling - No File", True, "Properly handles missing file")
            else:
                self.log_result("Error Handling - No File", False, f"Unexpected status: {response.status_code}")
            
            # Test progress for non-existent fileId
            response = self.session.get(f"{BASE_URL}/compress/progress/nonexistent", timeout=TIMEOUT)
            if response.status_code == 404:
                self.log_result("Error Handling - Invalid Progress ID", True, "Properly handles invalid fileId")
            else:
                self.log_result("Error Handling - Invalid Progress ID", False, f"Unexpected status: {response.status_code}")
            
            # Test download for non-existent fileId
            response = self.session.get(f"{BASE_URL}/download/nonexistent", timeout=TIMEOUT)
            if response.status_code == 404:
                self.log_result("Error Handling - Invalid Download ID", True, "Properly handles invalid download fileId")
                return True
            else:
                self.log_result("Error Handling - Invalid Download ID", False, f"Unexpected status: {response.status_code}")
                return False
                
        except Exception as e:
            self.log_result("Error Handling", False, f"Error handling test failed: {str(e)}")
            return False
    
    def test_cors_headers(self):
        """Test CORS headers are properly set"""
        try:
            response = self.session.get(f"{BASE_URL}", timeout=TIMEOUT)
            
            cors_headers = {
                'Access-Control-Allow-Origin': response.headers.get('Access-Control-Allow-Origin'),
                'Access-Control-Allow-Methods': response.headers.get('Access-Control-Allow-Methods'),
                'Access-Control-Allow-Headers': response.headers.get('Access-Control-Allow-Headers')
            }
            
            if cors_headers['Access-Control-Allow-Origin']:
                self.log_result("CORS Headers", True, "CORS headers are properly set", cors_headers)
                return True
            else:
                self.log_result("CORS Headers", False, "CORS headers missing", cors_headers)
                return False
                
        except Exception as e:
            self.log_result("CORS Headers", False, f"CORS test failed: {str(e)}")
            return False
    
    def run_all_tests(self):
        """Run all backend tests"""
        print("=" * 60)
        print("SQUNCH BACKEND API TESTING")
        print("=" * 60)
        
        # Test 1: API Root
        self.test_api_root()
        
        # Test 2: Image Compression
        self.test_image_compression()
        
        # Test 3: Video Compression Start
        file_id = self.test_video_compression_start()
        
        # Test 4: Progress Tracking
        if file_id:
            # Wait a moment for progress to be recorded
            time.sleep(2)
            progress_data = self.test_progress_tracking(file_id)
            
            # Test 5: Download (might fail if video compression isn't complete)
            self.test_download_endpoint(file_id)
        
        # Test 6: Error Handling
        self.test_error_handling()
        
        # Test 7: CORS Headers
        self.test_cors_headers()
        
        # Summary
        print("\n" + "=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)
        
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
        
        return passed == total

if __name__ == "__main__":
    tester = SqunchAPITester()
    success = tester.run_all_tests()
    exit(0 if success else 1)