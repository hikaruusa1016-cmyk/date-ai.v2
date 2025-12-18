#!/bin/bash
curl -X POST http://localhost:3001/api/generate-plan \
  -H "Content-Type: application/json" \
  -d '{"user_age":25,"partner_age":24,"date_phase":"first","area":"shibuya","budget":"medium","user_interests":["gourmet","walk"],"partner_interests":["gourmet","cafe"]}' \
  -s | jq '.schedule[] | select(.type == "lunch" or .type == "dinner") | {time, type, place_name, affiliateLinks}'
