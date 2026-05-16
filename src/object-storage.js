/**
 * Wrapper Object Storage S3-compatible (Hetzner Object Storage en prod).
 *
 * Mode disque local (FALLBACK) : si OBJECT_STORAGE_ENDPOINT n'est pas
 * configuré, on continue d'écrire sur disk dans /data/uploads — c'est utile
 * en dev local + en transition.
 *
 * Mode S3 : on écrit dans le bucket distant + on retourne une URL publique
 * (servie par CF si configuré devant).
 *
 * Env vars (prod) :
 *   OBJECT_STORAGE_ENDPOINT   ex: https://fsn1.your-objectstorage.com
 *   OBJECT_STORAGE_REGION     ex: fsn1
 *   OBJECT_STORAGE_BUCKET     ex: maquickpage-uploads
 *   OBJECT_STORAGE_ACCESS_KEY
 *   OBJECT_STORAGE_SECRET_KEY
 *   OBJECT_STORAGE_PUBLIC_URL ex: https://uploads.maquickpage.fr  (CDN devant)
 *                              fallback: https://{bucket}.{endpoint}
 */

import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ENDPOINT = process.env.OBJECT_STORAGE_ENDPOINT || '';
const REGION = process.env.OBJECT_STORAGE_REGION || 'fsn1';
const BUCKET = process.env.OBJECT_STORAGE_BUCKET || '';
const ACCESS_KEY = process.env.OBJECT_STORAGE_ACCESS_KEY || '';
const SECRET_KEY = process.env.OBJECT_STORAGE_SECRET_KEY || '';
const PUBLIC_URL = process.env.OBJECT_STORAGE_PUBLIC_URL || (ENDPOINT && BUCKET ? `${ENDPOINT.replace('https://', `https://${BUCKET}.`)}` : '');

const isS3Configured = !!(ENDPOINT && BUCKET && ACCESS_KEY && SECRET_KEY);

// Fallback disk local (mode dev / transition)
const LOCAL_UPLOADS_DIR = process.env.UPLOADS_DIR
  || (process.env.SCREENSHOTS_DIR ? join(dirname(process.env.SCREENSHOTS_DIR), 'uploads') : './data/uploads');

let s3Client = null;
function getClient() {
  if (s3Client) return s3Client;
  if (!isS3Configured) return null;
  s3Client = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    forcePathStyle: false, // Hetzner accepte virtual-hosted style (bucket.endpoint)
  });
  return s3Client;
}

export function isObjectStorageConfigured() {
  return isS3Configured;
}

/**
 * Upload un buffer vers Object Storage (ou disk local en fallback).
 * @param {string} key - chemin relatif (ex: "salon-slug/hero-1234.jpg")
 * @param {Buffer} buffer - contenu binaire
 * @param {string} contentType - ex: "image/jpeg"
 * @returns {Promise<string>} URL publique pour servir le fichier
 */
export async function uploadObject(key, buffer, contentType = 'image/jpeg') {
  if (isS3Configured) {
    const client = getClient();
    await client.send(new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable', // 1 an : les filenames sont uniques (timestamp+random)
      ACL: 'public-read', // Hetzner supporte public-read même si discret
    }));
    return `${PUBLIC_URL}/${key}`;
  }
  // Fallback disk local : on garde le comportement historique
  const filepath = join(LOCAL_UPLOADS_DIR, key);
  mkdirSync(dirname(filepath), { recursive: true });
  writeFileSync(filepath, buffer);
  return `/uploads/${key}`;
}

/**
 * Supprime un objet du storage. Tolère les paths d'ancien format /uploads/...
 * et les URLs absolues du bucket.
 * @param {string} pathOrUrl
 */
export async function deleteObject(pathOrUrl) {
  if (!pathOrUrl) return;
  // Normalise : extrait la "key" (ex: "salon-slug/hero-1234.jpg")
  let key;
  if (pathOrUrl.startsWith('http')) {
    // URL absolue : on extrait après le domaine
    try {
      const u = new URL(pathOrUrl);
      key = u.pathname.replace(/^\/+/, '');
    } catch { return; }
  } else if (pathOrUrl.startsWith('/uploads/')) {
    key = pathOrUrl.replace(/^\/uploads\//, '');
  } else {
    key = pathOrUrl;
  }

  if (isS3Configured) {
    const client = getClient();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (err) {
      console.warn('[object-storage] DELETE error (ignoré):', err.message);
    }
    return;
  }
  // Disk local
  const filepath = join(LOCAL_UPLOADS_DIR, key);
  if (existsSync(filepath)) {
    try { unlinkSync(filepath); } catch (err) { /* ignore */ }
  }
}

/**
 * Vérifie si un objet existe (utile pour migration/audit).
 */
export async function objectExists(key) {
  if (isS3Configured) {
    const client = getClient();
    try {
      await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
      return true;
    } catch { return false; }
  }
  return existsSync(join(LOCAL_UPLOADS_DIR, key));
}

export default {
  isObjectStorageConfigured,
  uploadObject,
  deleteObject,
  objectExists,
};
