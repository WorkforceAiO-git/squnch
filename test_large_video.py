#!/usr/bin/env python3
"""
Test large video compression to demonstrate better compression ratios
"""

import requests
import json
import time
import uuid

BASE_URL = "http://localhost:3000/api"
TIMEOUT = 60

def test_large_video_compression():
    """Test compression with a larger, more realistic video"""
    
    # Load the large test video
    with open('/tmp/test_video_large.mp4', 'rb') as f:
        video_data = f.read()
    
    print(f"Testing large video compression:")
    print(f"Original size: {len(video_data)} bytes ({len(video_data)/1024:.1f} KB)")
    
    file_id = str(uuid.uuid4())
    
    # Start compression
    files = {
        'file': ('large_test_video.mp4', video_data, 'video/mp4'),
        'fileId': (None, file_id)
    }
    
    print("Starting compression...")
    response = requests.post(f"{BASE_URL}/compress/video", files=files, timeout=TIMEOUT)
    
    if response.status_code != 200:
        print(f"❌ Failed to start compression: {response.status_code} - {response.text}")
        return False
    
    print("✅ Compression started successfully")
    
    # Monitor progress
    start_time = time.time()
    while True:
        time.sleep(2)
        
        progress_response = requests.get(f"{BASE_URL}/compress/progress/{file_id}", timeout=TIMEOUT)
        if progress_response.status_code != 200:
            print(f"❌ Progress check failed: {progress_response.status_code}")
            return False
        
        progress_data = progress_response.json()
        status = progress_data.get('status')
        progress = progress_data.get('progress', 0)
        fps = progress_data.get('currentFps', 'N/A')
        kbps = progress_data.get('currentKbps', 'N/A')
        
        print(f"Progress: {progress}% - Status: {status} - FPS: {fps} - Bitrate: {kbps} kbps")
        
        if status == 'completed':
            compressed_size = progress_data.get('compressedSize')
            compression_ratio = progress_data.get('compressionRatio')
            processing_time = time.time() - start_time
            
            print(f"\n🎉 Compression completed!")
            print(f"Original size: {len(video_data)} bytes ({len(video_data)/1024:.1f} KB)")
            print(f"Compressed size: {compressed_size} bytes ({compressed_size/1024:.1f} KB)")
            print(f"Compression ratio: {compression_ratio}%")
            print(f"Processing time: {processing_time:.1f} seconds")
            
            # Test download
            download_response = requests.get(f"{BASE_URL}/download/{file_id}", timeout=TIMEOUT)
            if download_response.status_code == 200:
                downloaded_size = len(download_response.content)
                print(f"✅ Download successful: {downloaded_size} bytes")
                
                # Save the compressed file for verification
                with open(f'/tmp/compressed_large_{file_id}.mp4', 'wb') as f:
                    f.write(download_response.content)
                print(f"✅ Compressed video saved to /tmp/compressed_large_{file_id}.mp4")
                
                return True
            else:
                print(f"❌ Download failed: {download_response.status_code}")
                return False
                
        elif status == 'error':
            error_msg = progress_data.get('error', 'Unknown error')
            print(f"❌ Compression failed: {error_msg}")
            return False
        
        # Timeout after 2 minutes
        if time.time() - start_time > 120:
            print("❌ Compression timeout")
            return False

if __name__ == "__main__":
    success = test_large_video_compression()
    exit(0 if success else 1)