# Running Order

A personal podcast player for iPhone. You rank your shows, and new episodes land in the queue by rank.

## Add or remove a show
Edit `shows.json`. Each line is a show name. Add `"by"` when several shows share a name, or use a feed link as the name.

## If a show matched the wrong podcast
Remove its line from `resolved.json` and add a `"by"` value in `shows.json`, or replace the name with its feed link.

## Main order
`"mainOrder"` lists shows by name in the order to play them. The app applies it once when it changes, so your own drags afterward stay. `"oldestFirst"` plays those shows oldest episode first.

## Queues
`"queue": "History"` puts a show in its own queue. Shows without one go in Main. You can also move a show to another queue in the app.

## Story shows
`"oldest": true` starts a show at its first episode and keeps the next three queued as you listen.

## Add a link out
`"watch": "https://..."` and `"watchLabel": "Open on Rumble"` add a link under each episode of that show.

## Limit a show or follow a person
- `"days": ["Fri"]` keeps only that day's episodes, in Pacific time.
- `"match": "News Quiz"` keeps only episodes with those words in the title.
- `"exclude": "best of|rerun"` drops episodes with any of those words in the title.
- `"minMinutes": 60` drops episodes shorter than that.
- `"hours": true` labels each day's episodes Hour 1, Hour 2 and so on, and short clips Bonus.
- `{ "search": "Mark Halperin", "title": "Everything with Mark Halperin" }` collects episodes naming that person from any podcast. Add `"since": "2026-10-01"` to set a start date; otherwise it covers the last year. Add `"except": ["Show Name"]` to leave out a show.

Episodes refresh every hour. To refresh now, open Actions, choose "Check for new episodes", and press Run workflow.
