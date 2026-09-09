import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/** Permanently deletes every payment-proof image uploaded for an event */
export async function deleteEventPaymentProofs(eventCode: string): Promise<number> {
  const prefix = `meeple-loop/${eventCode}/payment-proofs`;
  const result = await cloudinary.api.delete_resources_by_prefix(prefix);
  return Object.keys(result.deleted ?? {}).length;
}
