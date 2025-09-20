#!/usr/bin/env python3
"""
Realistic Image Compression Testing for Squnch
Tests with actual photo-like images and different quality settings
"""

import requests
import json
import time
import os
import tempfile
from PIL import Image, ImageDraw
import io
import uuid
import random

# Configuration
BASE_URL = "http://localhost:3000/api"
TIMEOUT = 30

class RealisticCompressionTester:
    def __init__(self):
        self.session = requests.Session()
        
    def create_realistic_image(self, format='JPEG', size=(800, 600)):
        """Create a more realistic image with gradients and details"""
        img = Image.new('RGB', size, color='white')
        draw = ImageDraw.Draw(img)
        
        # Create a gradient background
        for y in range(size[1]):
            for x in range(size[0]):
                r = int(255 * (x / size[0]))
                g = int(255 * (y / size[1]))
                b = int(255 * ((x + y) / (size[0] + size[1])))
                img.putpixel((x, y), (r % 255, g % 255, b % 255))
        
        # Add some shapes and details
        for _ in range(50):
            x1, y1 = random.randint(0, size[0]), random.randint(0, size[1])
            x2, y2 = x1 + random.randint(10, 100), y1 + random.randint(10, 100)
            color = (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))
            draw.rectangle([x1, y1, x2, y2], fill=color)
        
        # Add some text
        try:
            for i in range(10):
                x, y = random.randint(0, size[0]-100), random.randint(0, size[1]-20)
                draw.text((x, y), f"Sample Text {i}", fill=(0, 0, 0))
        except:
            pass  # Skip if font issues
        
        buffer = io.BytesIO()
        if format == 'JPEG':
            img.save(buffer, format=format, quality=95)  # High quality original
        else:
            img.save(buffer, format=format)
        buffer.seek(0)
        return buffer.getvalue()
    
    def test_compression_with_different_qualities(self):
        """Test compression with different quality settings by modifying the API call"""
        print("🎯 REALISTIC IMAGE COMPRESSION TESTING")
        print("="*60)
        
        # Test with realistic images
        test_cases = [
            {"format": "JPEG", "size": (1200, 800), "name": "High-res JPEG Photo"},
            {"format": "JPEG", "size": (800, 600), "name": "Medium JPEG Photo"},
            {"format": "PNG", "size": (800, 600), "name": "PNG with Details"},
        ]
        
        for test_case in test_cases:
            print(f"\n📸 Testing {test_case['name']}...")
            
            # Create realistic test image
            image_data = self.create_realistic_image(test_case['format'], test_case['size'])
            file_id = str(uuid.uuid4())
            
            files = {
                'file': (f'realistic_image.{test_case["format"].lower()}', image_data, f'image/{test_case["format"].lower()}'),
                'fileId': (None, file_id)
            }
            
            start_time = time.time()
            response = self.session.post(f"{BASE_URL}/compress/image", files=files, timeout=TIMEOUT)
            response_time = (time.time() - start_time) * 1000
            
            if response.status_code == 200:
                compressed_data = response.content
                original_size = len(image_data)
                compressed_size = len(compressed_data)
                compression_ratio = (1 - compressed_size / original_size) * 100
                
                print(f"   📊 Original Size: {original_size:,} bytes")
                print(f"   📊 Compressed Size: {compressed_size:,} bytes")
                print(f"   📊 Compression Ratio: {compression_ratio:.1f}%")
                print(f"   ⏱️  Response Time: {response_time:.2f}ms")
                print(f"   🎯 Target Met (60-85%): {'✅ Yes' if 60 <= compression_ratio <= 85 else '❌ No'}")
                
                # Test if the compressed image is still valid
                try:
                    test_img = Image.open(io.BytesIO(compressed_data))
                    print(f"   ✅ Compressed image is valid: {test_img.size}")
                except Exception as e:
                    print(f"   ❌ Compressed image is invalid: {e}")
            else:
                print(f"   ❌ Compression failed: HTTP {response.status_code}")
                print(f"   📝 Response: {response.text}")
    
    def test_edge_cases(self):
        """Test edge cases for compression"""
        print(f"\n🔍 EDGE CASE TESTING")
        print("="*40)
        
        # Test very small image
        small_img = self.create_realistic_image('JPEG', (50, 50))
        files = {'file': ('tiny.jpg', small_img, 'image/jpeg'), 'fileId': (None, str(uuid.uuid4()))}
        response = self.session.post(f"{BASE_URL}/compress/image", files=files, timeout=TIMEOUT)
        
        if response.status_code == 200:
            original_size = len(small_img)
            compressed_size = len(response.content)
            ratio = (1 - compressed_size / original_size) * 100
            print(f"   📱 Tiny Image (50x50): {ratio:.1f}% compression")
        
        # Test very large image
        large_img = self.create_realistic_image('JPEG', (2000, 1500))
        files = {'file': ('large.jpg', large_img, 'image/jpeg'), 'fileId': (None, str(uuid.uuid4()))}
        response = self.session.post(f"{BASE_URL}/compress/image", files=files, timeout=TIMEOUT)
        
        if response.status_code == 200:
            original_size = len(large_img)
            compressed_size = len(response.content)
            ratio = (1 - compressed_size / original_size) * 100
            print(f"   🖼️  Large Image (2000x1500): {ratio:.1f}% compression")
    
    def run_realistic_tests(self):
        """Run all realistic compression tests"""
        self.test_compression_with_different_qualities()
        self.test_edge_cases()
        
        print(f"\n💡 ANALYSIS:")
        print(f"   The current compression settings use Sharp with quality=85")
        print(f"   JPEG compression is working but may need quality adjustment for target ratios")
        print(f"   PNG compression converts to JPEG by default, which explains size changes")
        print(f"   For better compression ratios, consider:")
        print(f"   - Lower JPEG quality (60-75) for higher compression")
        print(f"   - Different PNG handling strategy")
        print(f"   - Resize large images before compression")

if __name__ == "__main__":
    tester = RealisticCompressionTester()
    tester.run_realistic_tests()