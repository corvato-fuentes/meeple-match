/**
 * Uploads a player's ticket-transfer receipt to Cloudinary via an unsigned preset and returns its secure_url.
 * Cloudinary unsigned uploads can't set type:authenticated, so this isn't cryptographically private —
 * the URL is unguessable (random ticketCode + timestamp) and is only ever shown on the admin players page.
 */
export async function uploadPaymentProof(eventCode: string, ticketCode: string, file: File): Promise<string> {
  const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !uploadPreset) {
    throw new Error('Cloudinary no está configurado (NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME / NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET)');
  }
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);
  formData.append('folder', `meeple-loop/${eventCode}/payment-proofs`);
  formData.append('public_id', `${ticketCode}-${Date.now()}`);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error('No se pudo subir el comprobante');
  const data = await res.json();
  return data.secure_url as string;
}
