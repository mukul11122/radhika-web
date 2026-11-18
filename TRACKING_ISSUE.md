# Tracking Not Working - Issue Analysis

## Root Cause
The SQLite database file `submissions.db` does not exist. The tracking feature relies on the database to store and look up docket records.

## Files Involved
- `backend/server.js` - Main server, initializes DB via `db.initDB()`
- `backend/db.js` - Database functions (SQLite by default)
- `js/track.js` - Client-side tracking form handler
- `track.html` - Tracking lookup page
- `api/docket` endpoint - Handles lookup requests

## How Tracking Works
1. User visits `track.html` and enters mobile number or store code
2. `track.js` fetches `/api/docket?phone=XXX` or `/api/docket?store=XXX`
3. `backend/server.js` `/api/docket` endpoint queries the database
4. Results are rendered with courier tracking URLs (if courier is recognized)

## Fix Steps
1. Initialize the database:
   ```powershell
   node backend/server.js
   ```
   This creates `submissions.db` and the docket table.

2. Import docket data:
   - Upload Excel via `POST /api/courier/dockets/upload`, or
   - Use `POST /api/submit` for submissions, or
   - Insert directly via the API

3. Test tracking at `track.html`

## Common Issues After Fix
- **No dockets found**: Ensure dockets were imported with mobile numbers or store codes
- **No "Live Tracking" link**: The `courierTrackUrl` function only generates links for known couriers (Delhivery, Blue Dart, DTDC, India Post, etc.). Unknown couriers will show the tracking number but no link.
- **Rate limiting**: Max 5 lookups per mobile number per hour (configurable in `backend/server.js`)