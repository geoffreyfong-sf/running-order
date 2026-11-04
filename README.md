# Running Order

A personal podcast player for iPhone. You rank your shows, and new episodes land in the queue by rank.

## Add or remove a show
Edit `shows.json`. Each line is a show name. Add `"by"` when several shows share a name, or use a feed link as the name.

## If a show matched the wrong podcast
Remove its line from `resolved.json` and add a `"by"` value in `shows.json`, or replace the name with its feed link.

Episodes refresh every hour. To refresh now, open Actions, choose "Check for new episodes", and press Run workflow.
