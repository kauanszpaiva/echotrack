/** Attach the current Clerk session token so the API can authenticate the request. */
async function withAuthHeaders(init: HeadersInit = {}): Promise<Headers> {
  const headers = new Headers(init);
  const token = await (window as any).Clerk?.session?.getToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

/**
 * A safe fetch wrapper that reads response as text first to handle non-JSON errors gracefully.
 * This prevents "Unexpected token <" errors and provides better debugging info.
 */
export async function safeFetch(url: string, options: RequestInit = {}) {
  const headers = await withAuthHeaders(options.headers);

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  const text = await response.text();
  
  // Log non-JSON or error responses for debugging
  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    if (text.includes('Cookie check')) {
      console.warn('[safeFetch] Intercepted by Platform Cookie Check');
      throw new Error("Action required: Your browser is blocking a security cookie. Please open in a new tab.");
    }
    console.error(`[safeFetch] Received non-JSON response from ${url}:`, text.substring(0, 500));
    throw new Error(`Server returned non-JSON response (${response.status}) for ${url}`);
  }

  try {
    const data = JSON.parse(text);
    if (!response.ok) {
      const err: any = new Error(data.error || `Request failed with status ${response.status}`);
      err.status = response.status;
      if (data.code) err.code = data.code;
      // Copy other properties like email, name so caller can use them
      if (data.email) err.email = data.email;
      if (data.name) err.name = data.name;
      throw err;
    }
    return data;
  } catch (e: any) {
    if (e.status) throw e; // Already our mapped error above
    console.error(`[safeFetch] Failed to parse JSON from ${url}. Body:`, text);
    throw new Error("Failed to process server response.");
  }
}

export async function downloadFile(url: string, filename: string) {
  const headers = await withAuthHeaders();

  const response = await fetch(url, { headers, credentials: 'include' });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Download failed: ${text}`);
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(downloadUrl);
}
