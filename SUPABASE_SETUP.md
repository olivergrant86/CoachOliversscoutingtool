# Setting up cross-device login (Supabase)

This turns the app from "data stays on this one browser" into "sign in
with your email, see your data from any device." It requires a free
Supabase account — Supabase gives you both the login system and the
database, so you don't need to run your own server.

## 1. Create a Supabase project

1. Go to https://supabase.com and sign up (or log in).
2. Click **New Project**.
3. Pick any name (e.g. "coach-oliver-scouting"), set a database
   password (save it somewhere — you likely won't need it again, but
   just in case), and pick a region close to you.
4. Wait a minute or two for the project to finish provisioning.

## 2. Get your API credentials

1. In your new project, click the gear icon (**Project Settings**) in
   the left sidebar, then **API**.
2. You'll see **Project URL** and, under **Project API keys**, a key
   labeled **anon** / **public**.
3. Open `js/supabase-client.js` in this project and paste those two
   values in:

```js
const SUPABASE_URL = "https://your-project-ref.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOi...(long string)...";
```

The anon/public key is *meant* to be visible in client-side code like
this — it's not a secret by itself. What actually protects your data is
the Row Level Security policy set up in the next step.

## 3. Create the database table

1. In Supabase, click **SQL Editor** in the left sidebar, then
   **New query**.
2. Paste in the following and click **Run**:

```sql
create table public.scouting_data (
  user_id uuid references auth.users not null primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.scouting_data enable row level security;

create policy "Users can view their own data"
  on public.scouting_data for select
  using (auth.uid() = user_id);

create policy "Users can insert their own data"
  on public.scouting_data for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own data"
  on public.scouting_data for update
  using (auth.uid() = user_id);
```

This creates one table with one row per user, storing their entire
season/opponent data as a single JSON blob (the same shape the app
already used with `localStorage` — just moved to the cloud). The Row
Level Security policies are what actually enforce that a user can only
ever read or write their *own* row, no matter what — Supabase checks
this on its server, not in this app's code, so it can't be bypassed by
someone editing the JavaScript.

## 4. Turn on email sign-up

Email/password auth is on by default in a new Supabase project, so
there's usually nothing to do here. If you want to skip Supabase's
"confirm your email" step during testing (so new accounts work
immediately without clicking a confirmation link):

1. **Authentication** (left sidebar) → **Providers** → **Email**.
2. Toggle off **Confirm email**.
3. You can turn this back on later once you're ready for real use.

## 4b. Require approval before new sign-ups can use the app (optional)

By default, anyone who signs up gets access right away. This step adds
a manual approval gate: new accounts land on a "pending approval"
screen and can't see or save any data until you flip a switch for them
in Supabase's Table Editor.

1. Go to **SQL Editor** → **New query**, paste in the following, and
   click **Run**:

```sql
-- Tracks whether each user has been approved by a coach.
create table public.profiles (
  id uuid references auth.users not null primary key,
  email text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

-- Automatically creates a (not-yet-approved) profile row the moment
-- someone signs up, so you don't have to do anything manually for that.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, approved)
  values (new.id, new.email, false);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Grandfathers in every account that already existed before this
-- feature was added (i.e. you) as already-approved, so you don't get
-- locked out of your own data.
insert into public.profiles (id, email, approved)
select id, email, true from auth.users
on conflict (id) do nothing;

-- Tighten the existing scouting_data policies so approval is required
-- to read or write, not just to be signed in. This is enforced by
-- Postgres itself — it can't be bypassed from the browser.
drop policy "Users can view their own data" on public.scouting_data;
drop policy "Users can insert their own data" on public.scouting_data;
drop policy "Users can update their own data" on public.scouting_data;

create policy "Approved users can view their own data"
  on public.scouting_data for select
  using (
    auth.uid() = user_id
    and exists (select 1 from public.profiles where id = auth.uid() and approved = true)
  );

create policy "Approved users can insert their own data"
  on public.scouting_data for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.profiles where id = auth.uid() and approved = true)
  );

create policy "Approved users can update their own data"
  on public.scouting_data for update
  using (
    auth.uid() = user_id
    and exists (select 1 from public.profiles where id = auth.uid() and approved = true)
  );
```

2. You should see "Success. No rows returned."
3. **Table Editor** → **profiles** → find your own row → confirm
   `approved` shows `true`. If it shows `false` instead, click that
   cell and toggle it to `true` yourself before you push the new code,
   or you'll lock yourself out.

**Approving new sign-ups going forward:** whenever someone new signs
up, go to **Table Editor** → **profiles**, find their row (matched by
email), click the `approved` cell, and toggle it to `true`. They'll
get access the next time they load the page or log in — no restart or
redeploy needed on your end.

## 5. Push the code changes and redeploy

Commit and push the updated files (`index.html`, `js/storage.js`,
`js/supabase-client.js` with your real credentials, `js/auth.js`) the
same way you did before:

```
git add .
git commit -m "Add login and cloud sync"
git push
```

Vercel will automatically redeploy since it's connected to your GitHub
repo. Once it finishes, visiting your site should show a login screen
instead of the app.

## 6. Test it

1. Visit your live URL, click **Sign Up**, enter an email and a
   password (6+ characters).
2. If you left "Confirm email" on, check that inbox and click the
   confirmation link, then come back and **Log In**.
3. Add an opponent and import a game.
4. Open the same URL on a different computer or phone, log in with the
   same email/password — your data should be there.

## If something doesn't work

Open the browser console (F12 → Console) and see what error shows up —
paste that back for help debugging. The most likely culprits, in order:

- `supabase-client.js` still has the placeholder URL/key (typo'd or
  not replaced)
- The SQL script errored partway through (check the SQL Editor's
  output for a red error message)
- Email confirmation is still required and the account hasn't been
  confirmed yet
