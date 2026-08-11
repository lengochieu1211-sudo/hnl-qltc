export const compressImage = (
  dataUrl: string,
  maxDimension: number = 2800,
  quality: number = 0.9
): Promise<string> => {
  return new Promise((resolve) => {
    // If dataUrl is small or not a base64 image, resolve as-is
    if (!dataUrl || !dataUrl.startsWith('data:image')) {
      resolve(dataUrl);
      return;
    }

    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      // Only resize if image exceeds maxDimension
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      } else if (dataUrl.length < 1500000) {
        // If image is already sharp and under 1.5MB, do not compress further
        resolve(dataUrl);
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Use high quality image smoothing
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // Preserve PNG format if original was PNG and high quality
        const mimeType = dataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg';
        const compressedDataUrl = mimeType === 'image/png'
          ? canvas.toDataURL('image/png')
          : canvas.toDataURL('image/jpeg', quality);

        resolve(compressedDataUrl);
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => {
      resolve(dataUrl);
    };
    img.src = dataUrl;
  });
};
