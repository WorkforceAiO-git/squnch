#!/bin/bash

echo "🚀 Squnch - Push to GitHub"
echo "=========================="
echo ""

# Check if git is initialized
if [ ! -d .git ]; then
    echo "❌ Git not initialized. Run: git init"
    exit 1
fi

echo "📁 Current project status:"
echo "- Project: Squnch File Compression App"
echo "- Status: Complete with Gumroad-style design"
echo "- Features: Advanced compression, analytics, batch processing"
echo "- Price: $29.99 lifetime access"
echo ""

# Show current git status
echo "📊 Git Status:"
git status --short
echo ""

# Ask for GitHub repository URL
echo "🔗 To push to GitHub, you need to:"
echo ""
echo "1. Create a new repository on GitHub called 'squnch'"
echo "2. Copy the repository URL (e.g., https://github.com/yourusername/squnch.git)"
echo "3. Run these commands:"
echo ""
echo "   git remote add origin https://github.com/yourusername/squnch.git"
echo "   git branch -M main"
echo "   git push -u origin main"
echo ""

# Option to set remote if provided
read -p "📝 Enter your GitHub repository URL (or press Enter to skip): " repo_url

if [ ! -z "$repo_url" ]; then
    echo ""
    echo "🔧 Setting up GitHub remote..."
    git remote add origin "$repo_url" 2>/dev/null || git remote set-url origin "$repo_url"
    
    echo "🚀 Pushing to GitHub..."
    git branch -M main
    git push -u origin main
    
    if [ $? -eq 0 ]; then
        echo ""
        echo "✅ Successfully pushed Squnch to GitHub!"
        echo "🔗 Your repository: $repo_url"
        echo ""
        echo "🎉 Squnch is now saved on GitHub with all features:"
        echo "   ✨ Professional file compression"
        echo "   🎨 Beautiful Gumroad-style design"
        echo "   ⚡ Advanced quality presets"
        echo "   📊 Real-time analytics"
        echo "   💰 $29.99 lifetime pricing"
    else
        echo ""
        echo "❌ Push failed. Please check your GitHub credentials and repository URL."
        echo "💡 You may need to authenticate with GitHub first."
    fi
else
    echo ""
    echo "ℹ️  No repository URL provided. To push later, run:"
    echo "   git remote add origin <your-github-repo-url>"
    echo "   git push -u origin main"
fi

echo ""
echo "🎯 Squnch is ready for production!"
echo "   - Landing page: Professional conversion-focused design"
echo "   - Compression: 80%+ ratios with quality preservation"
echo "   - Features: Batch processing, analytics, celebrations"
echo "   - Price: Accessible $29.99 lifetime access"