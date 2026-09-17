-- ============================================================================
-- 0038_newsletter_images_bucket.sql
-- ============================================================================
-- Storage for images in newsletter campaigns, uploaded from the composer at
-- /admin/newsletter through /api/admin/newsletter/image.
--
-- PUBLIC, because an email client fetches the image with no credentials of
-- any kind, sometimes days after the send. Public read needs no policy; there
-- are deliberately no write policies, so only the service role (the admin
-- upload route) can add objects. Object names are random, so the bucket
-- cannot be listed by guessing.
--
-- 5 MB a file. JPEG, PNG and GIF only: WebP and AVIF, fine on the website,
-- are still not displayed by Outlook and a number of other mail clients.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'newsletter-images', 'newsletter-images', true, 5242880,
  array['image/jpeg', 'image/png', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
