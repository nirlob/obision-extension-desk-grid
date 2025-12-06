#!/bin/bash

# Script to create a new release: bump version, commit, tag, and push

set -e  # Exit on error

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")

# Split version into parts
IFS='.' read -ra VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR="${VERSION_PARTS[0]}"
MINOR="${VERSION_PARTS[1]}"
PATCH="${VERSION_PARTS[2]}"

# Increment minor version and reset patch to 0
NEW_MINOR=$((MINOR + 1))
NEW_VERSION="${MAJOR}.${NEW_MINOR}.0"

echo "🚀 Creating new release"
echo "Current version: v$CURRENT_VERSION"
echo "New version: v$NEW_VERSION"
echo ""

# Update package.json
echo "📝 Updating package.json..."
npm version $NEW_VERSION --no-git-tag-version

# Extract major version for metadata.json (metadata uses single number)
METADATA_VERSION="${MAJOR}"
if [ "$NEW_MINOR" -gt 0 ]; then
    METADATA_VERSION="${MAJOR}${NEW_MINOR}"
fi

# Update metadata.json
echo "📝 Updating metadata.json..."
jq --arg version "$METADATA_VERSION" '.version = ($version | tonumber)' metadata.json > metadata.json.tmp
mv metadata.json.tmp metadata.json

# Commit changes
echo "💾 Committing changes..."
git add metadata.json package.json package-lock.json
git commit -m "Release version $NEW_VERSION"

# Create tag
echo "🏷️  Creating tag v$NEW_VERSION..."
git tag -a "v$NEW_VERSION" -m "Release version $NEW_VERSION"

# Push to repository
echo "⬆️  Pushing to repository..."
git push origin master
git push origin "v$NEW_VERSION"

echo ""
echo "✅ Release $NEW_VERSION created successfully!"
echo ""
echo "GitHub Actions will now:"
echo "  1. Build the extension"
echo "  2. Create a GitHub release"
echo "  3. Attach the extension package to the release"
echo ""
echo "Check progress at: https://github.com/nirlob/obision-extension-desk-grid/actions"
