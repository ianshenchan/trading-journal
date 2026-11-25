# XAUUSD trading journal

A private journal for a gold trader. Each entry records the date, how many trades you took, and the profit or loss. An optional note can be up to 140 characters. There is no account, no server, and no build step.

The page is `index.html`, `styles.css`, and `app.js`.

## Run it

Open `index.html` in a browser. A `file://` address works on its own.

Or serve this folder:

```bash
npx serve
```

```bash
python3 -m http.server
```

Then open the address printed in the terminal.

Opening the file directly and opening it from a server are different browser stores. Entries saved in one will not appear in the other.

## Where your data is stored

Entries and the display currency are saved in the browser’s `localStorage` under the key `tradingJournal.v1`.

- Data stays in this browser on this device. It is not uploaded and it does not sync to another browser or phone.
- Clearing site data or the cache deletes it. A private or incognito window starts empty and drops its entries when the window closes.
- Browsers limit this storage to about 5 MB.
- Export a CSV regularly and keep that file as your backup. Use **Export all**, or **Export this range** for the dates selected in the summary.

CSV columns are `date`, `trades`, `profit_loss`, `currency`, and `note`. Commas and quotes in notes are escaped. **Import CSV** adds rows from a file with that header. Amounts are labelled with the currency you pick. They are not converted.
