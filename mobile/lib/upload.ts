/**
 * Putting a picked file into a multipart body.
 *
 * React Native ships its own FormData, which accepts a `{ uri, name, type }`
 * descriptor and streams the file off disk. That matters on a phone: it means a
 * four megabyte photo never has to exist as a string in JS, which is where
 * image uploads usually fall over.
 *
 * The browser has no such thing. Its FormData follows the spec, and the spec
 * coerces any non-Blob value to a string, so the same call sent the literal text
 * "[object Object]" and the server answered 422. The `.web` twin beside this
 * file does the conversion the browser needs; keeping both behind one function
 * means neither caller has to care.
 *
 * Async on both platforms even though this half does no waiting, so the call
 * shape never changes with the platform.
 */
export async function appendFile(
  form: FormData,
  field: string,
  file: { uri: string; name: string; mimeType: string },
): Promise<void> {
  // The cast is unavoidable: React Native accepts this object where the DOM
  // types insist on a Blob, and there is no Blob for a file uri here.
  form.append(field, {
    uri: file.uri,
    name: file.name,
    type: file.mimeType,
  } as unknown as Blob);
}
