# Settle Up

Split shared expenses with friends. Make a group, send the link, and everyone adds what they paid from their own phone. The app works out the fewest payments needed to settle up.

- No accounts for your friends. Anyone with the group link can view and add.
- Syncs live across phones.
- Installs to the home screen like an app.
- Free: hosted on GitHub Pages, data in Firebase's free plan.

Setup takes about 15 minutes, once.

## 1. Create the Firebase database (free)

1. Go to https://console.firebase.google.com and sign in with your Google account.
2. **Create a project** → name it `settle-up` → you can turn off Google Analytics → **Create**.
3. In the left menu: **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save**.
   (This gives each phone a hidden ID so the database can block random bots. Your friends never see a login.)
4. Left menu: **Build → Firestore Database → Create database** → pick a location near you → **Start in production mode** → **Create**.
5. In Firestore, open the **Rules** tab (repeat this whenever `firestore.rules` changes), delete what's there, paste everything from `firestore.rules`, and click **Publish**.
6. Click the gear icon → **Project settings** → scroll to **Your apps** → click the **`</>`** (Web) icon → name it `settle-up` → **Register app**. Leave "Firebase Hosting" unticked.
7. Firebase shows a `firebaseConfig = { ... }` block. Copy those values into `firebase-config.js`, replacing each `PASTE_...` value.

### Optional sign-in (Google and email link)

So people can get their groups back on any device:

1. **Authentication → Sign-in method → Add new provider → Google** → **Enable**, choose a support email → **Save**.
2. **Add new provider → Email/Password** → turn on **Email link (passwordless sign-in)**. You can leave the plain Email/Password switch off. Click **Save**.
3. Make sure your site is in **Authentication → Settings → Authorized domains** (step 3 below). Both sign-in methods need it.

Signing in is optional. Anyone can still join a group straight from the invite link.

## 2. Put it on GitHub Pages

1. On https://github.com, click **New repository** → name it `settle-up` → **Public** → **Create repository**.
2. Click **uploading an existing file**, drag in every file and the `icons` folder from this project, then **Commit changes**.
3. Go to **Settings → Pages**. Under **Branch**, pick `main` and `/ (root)` → **Save**.
4. After a minute your app is live at `https://<your-username>.github.io/settle-up/`.

## 3. Allow your site in Firebase

Firebase → **Authentication → Settings → Authorized domains → Add domain** → add `<your-username>.github.io`.

## Using it

1. Open your app link, enter a group name and your name, then **Create group**.
2. Tap **Copy invite link** and send it to your friends in your group chat.
3. Each friend opens the link and taps their name, or adds themselves if they're not listed. This happens once per device, and from then on the app knows who they are.
4. Whoever pays for something adds it from their own phone: what it was, the amount, the currency and who it's split between. Expenses are always recorded as paid by the person adding them.
5. **Who pays whom** always shows the fewest payments to even everyone out. Tap **Mark as paid** once someone pays back.

**Add to home screen:** on iPhone, open the link in Safari → Share → **Add to Home Screen**. On Android, open it in Chrome → menu → **Install app**.

## Accounts

Without an account, each phone remembers its own groups. If someone gets a new phone or clears their browser, they need the invite link again.

With an account (Google or an email link, no password), the start screen lists all your groups on any device, and you're recognized automatically in each one. Signing in on a phone that already has groups moves those groups to your account.

On iPhone, an email link opens in Safari. If you're using the home-screen app, copy the link from the email and paste it into the box on the app's start screen instead.

## Admins

Whoever creates a group is its admin. In **⋯ Group settings → People and admins**, admins can tap any name to make someone else an admin, unlink a name from a device (so that person can pick it again), or remove someone who isn't on any expenses. Admins can also delete any expense, rename the group, set the home currency before the first expense, and delete the whole group (**⋯ → Delete group**, confirmed by typing the group name). Groups created before this update don't have an admin, so start a new group to get one.

## Languages

The app comes in English and Traditional Chinese (繁體中文). It picks the phone's language automatically, and anyone can switch with the picker at the top right. To add another language, copy the `en` block in `i18n.js`, translate the values, and add it to the picker in `index.html`.

## Sharing a summary

On the **Balances** tab, **Share summary** creates a message with who pays whom, everyone's balance and (optionally) the full expense list. WhatsApp and Email open with the message filled in. Signal and More apps open the phone's share sheet. Copy text works everywhere.

## Trips abroad

Each group has a home currency, and all balances are settled in it. When you add an expense, pick the currency you actually paid in. The app fills in today's exchange rate and converts the amount back to the home currency. You can change the rate to match what your card or money changer actually gave you. Rates come from open.er-api.com (free, no key needed).

The home currency can only be changed before the first expense is added.

## Good to know

- In the home-screen app, pull down at the top of the screen to refresh. Changes from friends appear on their own anyway; refreshing is for reconnecting after being offline or picking up a new app version.
- Groups you've opened are kept on your phone, so they open instantly and you can look at them offline.

- Each device joins as one person. On iPhone, the home-screen app and Safari count as separate devices, so after adding it to the home screen you'll pick your name once more. Your name will show "joined on another device." Tap it twice to move it to this device.
- You can only delete expenses you added yourself.
- The group link works like a key. Anyone who has it can add or delete expenses, so only share it with the group.
- Firebase's free plan covers far more than a friend group will use (50,000 reads and 20,000 writes a day).
- To change the app later, edit the files and upload them to the repo again. Phones pick up the new version the next time they open it.
- The `firebase-config.js` values are meant to be public. The security rules in `firestore.rules` are what protect the data.

## Files

| File | What it does |
|---|---|
| `index.html` | The page layout |
| `style.css` | Colors, fonts, light and dark mode |
| `app.js` | Groups, expenses, balances and the settle-up math |
| `i18n.js` | All text in English and Traditional Chinese |
| `firebase-config.js` | Your Firebase project settings (you fill this in) |
| `firestore.rules` | Database security rules (paste into Firebase) |
| `manifest.webmanifest`, `sw.js`, `icons/` | Make it installable and quick to open |
