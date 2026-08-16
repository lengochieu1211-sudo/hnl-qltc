import { saveBlob, saveTextFile } from './fileExport';

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
      await saveTextFile(content, filename, mimeType);
      return;
    }
  } else {
    fileBlob = content;
  }

  await saveBlob(fileBlob, filename, mimeType);
};
