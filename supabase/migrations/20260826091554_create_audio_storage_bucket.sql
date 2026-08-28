/*
# VoiceGuard — Audio storage bucket for file uploads

## Purpose
Creates a Supabase Storage bucket named `audio_uploads` so visitors can upload
audio files (wav/mp3/m4a/ogg) for voice-clone analysis directly from the site.

## 1. Storage bucket
- `audio_uploads` — public-read bucket (files are referenced by public URL so the
  frontend can play them back and pass the URL to the analysis pipeline).
  50 MB max file size, allowed mime types: wav, mp3, m4a, ogg, webm, x-wav.

## 2. Storage policies
Because the app has no sign-in screen, policies allow anon + authenticated roles
to upload and read files. Delete is also allowed so stale demo uploads can be
cleaned up. This mirrors the single-tenant, public/shared model used by the
database tables.

## 3. Notes
- No auth references — consistent with the rest of the schema.
- Idempotent: bucket uses INSERT ... ON CONFLICT DO NOTHING via the storage API.
*/

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'audio_uploads',
  'audio_uploads',
  true,
  52428800,
  ARRAY['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3', 'audio/m4a', 'audio/x-m4a', 'audio/ogg', 'audio/webm']
)
ON CONFLICT (id) DO NOTHING;

-- Allow anyone to read uploaded audio (public bucket)
DROP POLICY IF EXISTS "anon_read_audio_uploads" ON storage.objects;
CREATE POLICY "anon_read_audio_uploads" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'audio_uploads');

-- Allow anyone to upload audio
DROP POLICY IF EXISTS "anon_insert_audio_uploads" ON storage.objects;
CREATE POLICY "anon_insert_audio_uploads" ON storage.objects
  FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'audio_uploads');

-- Allow anyone to delete audio (demo cleanup)
DROP POLICY IF EXISTS "anon_delete_audio_uploads" ON storage.objects;
CREATE POLICY "anon_delete_audio_uploads" ON storage.objects
  FOR DELETE TO anon, authenticated
  USING (bucket_id = 'audio_uploads');
