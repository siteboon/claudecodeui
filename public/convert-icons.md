# Convert SVG Icons to PNG

I've created SVG versions of the app icons that match the MessageSquare design from the sidebar. To convert them to PNG format, you can use one of these methods:

## Method 1: Online Converter (Easiest)
1. Go to https://cloudconvert.com/svg-to-png
2. Upload each SVG file from the `/icons/` directory
3. Download the PNG versions
4. Replace the existing PNG files

## Method 2: Using Node.js (if you have it)
```bash
npm install sharp
node -e "
const sharp = require('sharp');
const fs = require('fs');
const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
sizes.forEach(size => {
  const svgPath = \`./icons/icon-\${size}x\${size}.svg\`;
  const pngPath = \`./icons/icon-\${size}x\${size}.png\`;
  if (fs.existsSync(svgPath)) {
    sharp(svgPath).png().toFile(pngPath);
    console.log(\`Converted \${svgPath} to \${pngPath}\`);
  }
});
"
```

## Method 3: Using ImageMagick (if installed)
```bash
cd public/icons
for size in 72 96 128 144 152 192 384 512; do
  convert "icon-${size}x${size}.svg" "icon-${size}x${size}.png"
done
```

## Method 4: Using Inkscape (if installed)
```bash
cd public/icons
for size in 72 96 128 144 152 192 384 512; do
  inkscape --export-type=png "icon-${size}x${size}.svg"
done
```

## Icon Design
The new icons feature:
- Clean MessageSquare (chat bubble) design matching the sidebar
- Primary color background with rounded corners
- White stroke icon that's clearly visible
- Consistent sizing and proportions across all sizes
- Proper PWA-compliant format

Once converted, the PNG files will replace the existing ones and provide a consistent icon experience across all platforms.