import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';

/** Uploads a player's ticket-transfer receipt image and returns its public download URL */
export async function uploadPaymentProof(eventCode: string, ticketCode: string, file: File): Promise<string> {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `events/${eventCode}/payment-proofs/${ticketCode}-${Date.now()}.${ext}`;
  const storageRef = ref(storage, path);
  await uploadBytes(storageRef, file);
  return getDownloadURL(storageRef);
}
