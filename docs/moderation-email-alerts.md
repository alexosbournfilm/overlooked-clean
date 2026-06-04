# Moderation Email Alerts

Reports are stored in `public.content_reports` by the app.

After a report is saved, the app invokes the Supabase Edge Function:

`notify-content-report`

That function uses Resend to email the moderation/admin inbox with:

- report ID
- reason
- details
- content type and content ID
- reporter ID/name
- reported user ID/name
- the 24-hour review reminder

## Required Supabase Secrets

Set these in Supabase before deploying the function:

```sh
supabase secrets set RESEND_API_KEY="re_your_resend_key"
supabase secrets set RESEND_FROM_EMAIL="Overlooked <alerts@your-verified-domain.com>"
supabase secrets set MODERATION_ALERT_EMAIL="overlookedsupport@gmail.com"
```

Use a `RESEND_FROM_EMAIL` from a domain verified in your Resend account.

## Deploy

```sh
supabase functions deploy notify-content-report
```

## Current Flow

1. User taps Report.
2. App inserts into `public.content_reports`.
3. App invokes `notify-content-report` with the inserted report ID.
4. Function verifies the signed-in user owns that report.
5. Function sends the Resend email to `MODERATION_ALERT_EMAIL`.
6. Function marks `developer_notified = true` on the report.

If the email fails, the report still remains saved in `public.content_reports`.
