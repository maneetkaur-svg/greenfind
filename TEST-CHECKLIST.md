# Manual test checklist

Run this before any deploy that matters. Fifteen minutes.

The automated tests in `/tests` cover most of it already, so this is for
things a browser cannot judge — whether a page reads well, whether an error
message makes sense, whether the layout holds on a phone.

**Before you start:** know which URL you are testing. Production is
`greenfind-rho.vercel.app`. A preview deployment has its own address and
**shares the same database**, so anything you delete on a preview is gone
for real.

---

## 1. Getting in

| | Check | Expected |
|---|---|---|
| ☐ | Open the site signed out | Redirected to `/login` |
| ☐ | Type `/vendors` directly while signed out | Still redirected to `/login` |
| ☐ | Sign in with a wrong password | "Invalid login credentials", stays on the page |
| ☐ | Sign in correctly | Lands on the vendor list |
| ☐ | Your name and role show top right | Correct name, correct role |
| ☐ | Sign out | Back to `/login`, and Back in the browser does not get you in |

---

## 2. The vendor list

| | Check | Expected |
|---|---|---|
| ☐ | List loads | Vendors shown, or a clear empty state |
| ☐ | Search a legal name | Only matches shown |
| ☐ | Search a GSTIN | Found |
| ☐ | Filter by industry | Only that industry |
| ☐ | A company with two sites | "2 sites" marker on both rows |
| ☐ | Document counts | Match what is actually attached |

---

## 3. Adding a vendor — the long one

### Step 1, identity and registration

| | Check | Expected |
|---|---|---|
| ☐ | Type a valid GSTIN | PAN appears underneath, derived not typed |
| ☐ | Same GSTIN, check the state | Fills in from the first two digits |
| ☐ | Type nonsense in GSTIN | "Fifteen characters…" appears |
| ☐ | Pick Recycling | Service categories appear below, 8 of them |
| ☐ | Pick Packaging instead | Categories change to the 6 packaging ones |
| ☐ | Pick Plastic waste management | Four CPCB sub-categories open |
| ☐ | Pick no sub-category | Red "Pick at least one" under it |
| ☐ | Set MSME to Yes | Category and Udyam number appear |
| ☐ | Set MSME to No | Both disappear entirely, not just greyed |
| ☐ | Entity type → Private Limited | CIN field appears |
| ☐ | Use a GSTIN from an existing vendor | "already on record under this PAN", with a link option |
| ☐ | Click **Link as another site** | Company fields replaced by an explanation |

### Moving around

| | Check | Expected |
|---|---|---|
| ☐ | Click step 7 from step 1 | Goes there. Nothing is gated |
| ☐ | Click **Skip to review** | Jumps to the end |
| ☐ | Go back to step 2 | What you typed is still there |

### Remaining steps

| | Check | Expected |
|---|---|---|
| ☐ | Address: state disagrees with the GSTIN | Warning shown, not blocked |
| ☐ | Geography: click North | Its 10 states appear, all selected |
| ☐ | Untick two | Counter drops to 8/10 |
| ☐ | Click Pan India | All 36 selected |
| ☐ | Contacts: three rows, four fields each | Primary and secondary marked required |
| ☐ | Operations for a recycler | 15 plant fields |
| ☐ | Change industry to transportation | Fleet replaces Operations |
| ☐ | Recycler: CTO and EPR steps exist | 22 and 14 fields |
| ☐ | Transporter: no CTO or EPR step | Correct, they do not hold them |
| ☐ | Documents step | GST, PAN, cheque, Udyam, profile, NDA listed |
| ☐ | Attach a PDF to GST certificate | Filename and size shown underneath |
| ☐ | Try a .docx | Refused |

### Creating

| | Check | Expected |
|---|---|---|
| ☐ | Press Create with nothing filled in | Lists every problem, each with a link to its step |
| ☐ | Click one of those links | Goes to the right step |
| ☐ | Fill it in properly and create | Button shows upload progress, then the record opens |
| ☐ | Check Supabase → `company` and `vendor_site` | A row in each |
| ☐ | Check `site_contact`, `site_geography` | Rows match what you entered |
| ☐ | Check Storage → `vendor-documents` | The file is there |

---

## 4. The vendor record

| | Check | Expected |
|---|---|---|
| ☐ | Open from the list | Loads, no error |
| ☐ | Click every tab | All open, none error |
| ☐ | Edit a field and save | "Saved." appears |
| ☐ | Reload | The change is still there |
| ☐ | Banking: a bad IFSC | "Eleven characters, like HDFC0000432" |
| ☐ | Contacts: clear the primary name and save | Refused with a reason |
| ☐ | Documents: attach, view, replace, remove | All four work |
| ☐ | A document expiring inside 60 days | Amber warning on the row |
| ☐ | A company with two sites | Sibling strip at the top, links work |

---

## 5. The NDA

| | Check | Expected |
|---|---|---|
| ☐ | Agreements → Download | File downloads |
| ☐ | Open it | Legal name, address, GSTIN, signatory all filled in |
| ☐ | Count the clauses | Eleven |
| ☐ | Fitsol block present | Anand Pathak, Gurugram address |
| ☐ | Upload signed copy | Attaches |
| ☐ | Check the Documents tab | Same file appears as NDA (signed) |

---

## 6. Roles

Sign in as a `user` account.

| | Check | Expected |
|---|---|---|
| ☐ | Vendor list | Visible |
| ☐ | Add vendor button | Not there |
| ☐ | Open `/vendors/new` directly | Redirected away |
| ☐ | Open a record | Read only marker, every field disabled |
| ☐ | Save buttons | None |
| ☐ | `/users` directly | Redirected away |

Sign in as a Super Admin.

| | Check | Expected |
|---|---|---|
| ☐ | Users link in the top nav | Present |
| ☐ | Add someone with the user role | They can sign in immediately, no email |
| ☐ | Change a role | Saves |
| ☐ | Disable an account | They cannot sign in |
| ☐ | Your own row | Role cannot be changed, cannot disable yourself |

---

## 7. On a phone

Open the site on your phone, or press F12 and switch to a narrow width.

| | Check | Expected |
|---|---|---|
| ☐ | Login | Fits, no sideways scroll |
| ☐ | Vendor list | Table scrolls sideways inside its own box |
| ☐ | Wizard | Steps stack above the form |
| ☐ | Four-across contact fields | Stack to one column |
| ☐ | Buttons | Large enough to tap |

---

## 8. Import

Use the template from the import page, or any spreadsheet. Sign in as Operations.

| | Check | Expected |
|---|---|---|
| ☐ | Vendors page | **Import** button next to Add vendor; not there for a `user` account |
| ☐ | Open `/vendors/import` as a `user` account | Redirected away |
| ☐ | Download the template | Three sheets; top row stays put when you scroll; pincode column is Text |
| ☐ | Import the template's **Example** sheet | Two rows, no problems; the scruffy one is cleaned (Packing becomes Packaging, +91 removed) |
| ☐ | Drop a file with oddly named columns ("GST No", "Company Name") | Matched automatically, each shows what it matched on |
| ☐ | Change one match by hand | The other column using that field lets go of it |
| ☐ | Check a file with a bad GSTIN | Row is **held back**, listed by spreadsheet row number |
| ☐ | Check a file with a bad IFSC or mobile | Row still imports; value left blank; listed as fixable |
| ☐ | Two rows, same PAN, different states | One company, two sites; "2 sites" on both rows |
| ☐ | Import the same file twice | Second time: sites refused as already on record, nothing duplicated |
| ☐ | A site under a PAN already on record | Attaches to that company; its details are not overwritten |
| ☐ | Download the problem list | CSV opens in Excel with row, GSTIN, problem, outcome |
| ☐ | Open an imported vendor | Banner or marker shows it was migrated; categories empty (not importable) |
| ☐ | "Undo this import" on the finished screen | SQL lists only the codes this import created |

---

## 9. When something breaks

**Write down:** the URL, what you clicked, what you expected, what happened,
and the exact error text.

**Then look at:** Vercel → your project → the latest deployment → Runtime Logs.
Search for the reference number if you were given one.

**A build failure** is different — Vercel → the failed deployment → Build Logs,
and scroll up to the first red line. `exited with 1` at the bottom is never the
error, only the fact that there was one.
