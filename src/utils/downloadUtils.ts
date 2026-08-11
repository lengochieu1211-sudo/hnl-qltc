import { saveBlob } from './fileExport';

export const downloadOrShareFile = async (filename: string, content: string | Blob, mimeType: string) => {
  let fileBlob: Blob;
  if (typeof content === 'string') {
    // If it's a data URL, convert to Blob
    if (content.startsWith('data:')) {
      const arr = content.split(',');
      const mime = arr[0].match(/:(.*?);/)?.[1] || mimeType;
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      fileBlob = new Blob([u8arr], { type: mime });
    } else {
      fileBlob = new Blob([content], { type: mimeType });
    }
  } else {
    fileBlob = content;
  }

  if (typeof window !== 'undefined' && window.AndroidExport?.saveBase64File) {
    await saveBlob(fileBlob, filename, mimeType);
    return;
  }

  // Try navigator.share (works great in mobile browsers)
  if (navigator.share && navigator.canShare) {
    const file = new File([fileBlob], filename, { type: fileBlob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: filename,
        });
        return;
      } catch (err) {
        console.warn('Share API failed, falling back to download anchor', err);
      }
    }
  }

  await saveBlob(fileBlob, filename, mimeType);
};
