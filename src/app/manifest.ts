import type { MetadataRoute } from 'next';
import { buildManifest } from '@/lib/pwaManifest';

export default function manifest(): MetadataRoute.Manifest {
  return buildManifest('/');
}
