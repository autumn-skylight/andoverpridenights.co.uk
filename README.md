# andoverpridenights.co.uk

andover lgbtq+ social groups website

## Private dates page

The `/dates` page is served by a Vercel function. In the Vercel project settings, add these environment variables for the deployment:

- `DATES_PAGE_PASSWORD`: the password to share with page visitors.
- `DATES_SESSION_SECRET`: a separate, randomly generated secret used to sign login sessions.

The dates are not returned until a visitor enters the password. Login sessions expire after eight hours.

### Managing dates

Edit `dates.json` in the API repository to change the dates or notes. The live API file is https://api.andoverpridenights.co.uk/dates.json. Each entry controls one date:

```json
{
  "date": "2027-01-06",
  "beside": "hosted at vicolo lounge",
  "underneath": "second meet:"
}
```

Use `YYYY-MM-DD` for dates. Change `date` to move a meet-up, edit either note, or copy an entry (including the comma between entries) to add another date. Leave a note as an empty string when you do not need it. Dates are sorted automatically. Commit and push to publish the changes through Vercel.
