/**
 * The browser half of the upload seam. See upload.ts for why this exists.
 *
 * On web the picker hands back a `blob:` or `data:` uri, which fetch can read
 * back out of the browser's own store without a network request. That gives a
 * real Blob, which is the only thing the spec's FormData will accept as a file.
 */
export async function appendFile(
  form: FormData,
  field: string,
  file: { uri: string; name: string; mimeType: string },
): Promise<void> {
  const response = await fetch(file.uri);
  const blob = await response.blob();

  // File rather than Blob, because the server reads the filename off the part
  // and a bare Blob arrives as "blob" with no extension. FastAPI accepts it
  // either way, but the stored name is what a later download is called.
  form.append(field, new File([blob], file.name, { type: file.mimeType }));
}
