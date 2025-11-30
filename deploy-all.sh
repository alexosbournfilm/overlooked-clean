#!/usr/bin/env bash
set -e

PROJECT_REF=sdatmuzzsebvckfmnqsv  # your correct ref

echo "🚀 Deploying functions to project $PROJECT_REF ..."

supabase functions deploy delete-account --project-ref $PROJECT_REF
supabase functions deploy cancel-subscription --project-ref $PROJECT_REF
supabase functions deploy create-checkout-session --project-ref $PROJECT_REF

echo "✅ ALL functions deployed successfully!"
