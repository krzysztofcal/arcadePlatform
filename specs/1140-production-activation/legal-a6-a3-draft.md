# Legal draft: Privacy a6 and Terms a3 (#1140 Phase 2), for OWNER acceptance

Status: **ACCEPTED by the OWNER on 2026-11-26**, with the corrections accepted the same day after the PR #1328 review (block photo effect in both directions, moderation removes the imported Google photo and blocks further imports, photo-copy deletion after a moderator decision, moderator identifier retention). The texts below are final; their hashes are in `legal-a6-a3/manifest.json`. Moderators: the OWNER and the admin accounts (`ADMIN_USER_IDS`). Not published yet. Base texts:
- Privacy `2026-11-21-a5`
- Terms `2026-10-28-a2`

New immutable versions:
- `legal/privacy.2026-11-26-a6.{pl,en}.html`
- `legal/terms.2026-11-26-a3.{pl,en}.html`

The aliases `legal/privacy.{pl,en}.html` and `legal/terms.{pl,en}.html` stay on a5/a2 in release A and switch to a6/a3 in release B, together with the features (OWNER 2026-11-26). Only the changes below are made; every other sentence stays identical to the base.

Facts used (code and owner decisions in `specs/1140-ugc-safety/spec.md`):
- **Reports:**
  - fixed reason codes, no free text; max 10 reports per hour;
  - the server stores its own snapshot of the reported player's public identity as evidence;
  - the reported player is not told who reported them.
- **Blocks:**
  - the blocker's private filter; it never changes seats, turns, cards, CH or settlement;
  - the blocked player is not told; max 500 blocks.
- **Moderation:**
  - manual review by admins in the admin panel; decisions are audited;
  - possible outcomes: resolve, dismiss, remove the imported Google photo (copy deleted, Arcade fallback, further imports blocked), restrict the public profile;
  - the block also hides Google photos between both players at Poker tables (checked in both directions);
  - decisions keep the moderator's identifier (no foreign key, so it remains after a moderator's account deletion);
  - no automated decisions; no notifications.
- **Retention:**
  - a pending report leaves the queue only through a decision;
  - reports and decisions are kept while the reported account exists;
  - when the reporter deletes their account, the link to them is removed;
  - when the reported account is deleted, its reports, blocks and decisions are removed, and only an anonymous count of removed pending reports remains.

---

## Terms a3: changes

**Header:** `Version: 2026-11-26-a3`

### EN, section 4 "Conduct": the third paragraph ("Report problems or inappropriate conduct to contact@kcswh.pl.") is replaced by:

> You can report a player in the app from their profile or at a Poker table by choosing a reason from a fixed list, or report problems to contact@kcswh.pl. The reported player is not told who reported them. Do not file false or repeated reports; reports are limited per hour.
>
> You can block a player. A block is your private filter: on your screens it hides that player's avatar, reactions and gifts, and at Poker tables Google photos are not shown between the two of you in either direction. It does not change seats, turns, cards, CH or settlement, and the blocked player is not notified. You can unblock them at any time.
>
> Reports are reviewed manually by the project's moderators; there is no automated decision. If a breach of these Terms is confirmed, a moderator may remove your imported Google photo (its copy is deleted and the Arcade avatar is shown instead) and block further imports, or restrict your public profile so other users cannot see it. These measures do not delete your account, CH or game history. You can ask for a review of a decision or report an error at contact@kcswh.pl.

### EN, section 4, second paragraph: the last sentence ("Any future use of a photo requires your separate, informed permission.") is replaced by:

> You can separately and voluntarily allow your current Google profile photo to be used as your avatar; the Privacy Policy describes how it is processed. You can withdraw that permission in Account.

### PL, section 4 "Zasady zachowania": the third paragraph ("Problemy i niewłaściwe zachowanie zgłaszaj na contact@kcswh.pl.") is replaced by:

> Gracza możesz zgłosić w aplikacji z jego profilu lub przy stole pokerowym, wybierając powód z ustalonej listy, a problemy możesz też zgłaszać na contact@kcswh.pl. Zgłoszony gracz nie dowiaduje się, kto go zgłosił. Nie wysyłaj fałszywych ani powtarzanych zgłoszeń; liczba zgłoszeń na godzinę jest ograniczona.
>
> Możesz zablokować gracza. Blokada jest Twoim prywatnym filtrem: na Twoich ekranach ukrywa avatar, reakcje i prezenty tego gracza, a przy stole pokerowym zdjęcia Google nie są pokazywane między Wami w obie strony. Nie zmienia miejsc, kolejki, kart, CH ani rozliczeń, a zablokowany gracz nie dostaje o niej informacji. Blokadę możesz w każdej chwili zdjąć.
>
> Zgłoszenia są rozpatrywane ręcznie przez moderatorów projektu; nie są podejmowane decyzje automatyczne. Jeżeli naruszenie Regulaminu zostanie potwierdzone, moderator może usunąć Twoje zaimportowane zdjęcie Google (jego kopia jest kasowana, a zamiast niego pokazujemy avatar Arcade) i zablokować kolejne importy albo ograniczyć widoczność Twojego publicznego profilu dla innych użytkowników. Te działania nie usuwają konta, CH ani historii gier. O ponowne rozpatrzenie decyzji lub zgłoszenie błędu możesz poprosić na contact@kcswh.pl.

### PL, section 4, second paragraph: the last sentence ("Ewentualne przyszłe wykorzystanie zdjęcia wymaga osobnego świadomego zezwolenia.") is replaced by:

> Możesz osobno i dobrowolnie zezwolić na użycie aktualnego zdjęcia z profilu Google jako avatara; sposób jego przetwarzania opisuje Polityka prywatności. Zgodę możesz wycofać w Koncie.

---

## Privacy a6: changes

**Header:** `Version: 2026-11-26-a6`

### New section after "Optional Google profile photo"

**EN: "Reports, blocks and moderation"**

> When you report a player, we store your account identifier, the reported player's account identifier, the chosen reason, where you reported (profile or Poker table, with the table identifier), the time, and a snapshot of the reported player's public identity at that moment (public handle, player name and avatar) made by our server as evidence. The reported player is not told who reported them.
>
> When you block a player, we store your account identifier, the blocked player's identifier and the time. The block is used to filter what you see; at Poker tables Google photos are also not shown between the two of you in either direction.
>
> Moderators review reports manually in the administration panel. We record each decision (the report, the action taken, the moderator's identifier and the time) and, where applied, a block on further Google photo imports. Moderation can remove an imported Google photo (its copy is deleted and the Arcade avatar is shown instead) and block further imports, or restrict a public profile. It does not use automated decision-making.

**PL: „Zgłoszenia, blokady i moderacja”**

> Gdy zgłaszasz gracza, zapisujemy identyfikator Twojego konta, identyfikator konta zgłoszonego gracza, wybrany powód, miejsce zgłoszenia (profil albo stół pokerowy wraz z identyfikatorem stołu), czas oraz migawkę publicznej tożsamości zgłoszonego gracza z tej chwili (publiczny identyfikator, nazwę gracza i avatar), wykonaną przez nasz serwer jako dowód. Zgłoszony gracz nie dowiaduje się, kto go zgłosił.
>
> Gdy blokujesz gracza, zapisujemy identyfikator Twojego konta, identyfikator zablokowanego gracza i czas. Blokada służy do filtrowania tego, co widzisz; przy stole pokerowym zdjęcia Google nie są też pokazywane między Wami w obie strony.
>
> Moderatorzy rozpatrują zgłoszenia ręcznie w panelu administracyjnym. Zapisujemy każdą decyzję (zgłoszenie, podjęte działanie, identyfikator moderatora i czas), a w razie zastosowania także blokadę kolejnych importów zdjęcia Google. Moderacja może usunąć zaimportowane zdjęcie Google (jego kopia jest kasowana, a zamiast niego pokazujemy avatar Arcade) i zablokować kolejne importy albo ograniczyć widoczność publicznego profilu. Nie korzysta z automatycznego podejmowania decyzji.

### "Purposes and legal grounds": a new item after "Security, abuse prevention…"

- **EN:** "Handling reports and blocks, moderation and enforcing the Terms: Article 6(1)(f), protecting users and the service from abuse, and Article 6(1)(b) where it concerns the rules of the service you use."
- **PL:** „Obsługa zgłoszeń i blokad, moderacja oraz egzekwowanie Regulaminu: art. 6 ust. 1 lit. f, ochrona użytkowników i usługi przed nadużyciami, oraz art. 6 ust. 1 lit. b w zakresie zasad usługi, z której korzystasz.”

### "Retention": a new row

- **EN: "Reports, blocks and moderation decisions"**
  > While the reported or blocked account exists. If you delete your account, reports you made remain, but without the link to you. When a reported account is deleted, its reports, blocks and moderation decisions are deleted with it; only an anonymous count of pending reports removed this way is kept. Blocks you made are deleted with your account, and you can remove a block at any time. Moderation decisions keep the moderator's identifier for the same period.
- **PL: „Zgłoszenia, blokady i decyzje moderacyjne”**
  > Przez okres istnienia zgłoszonego lub zablokowanego konta. Jeżeli usuniesz konto, wysłane przez Ciebie zgłoszenia pozostają, ale bez powiązania z Tobą. Usunięcie zgłoszonego konta usuwa razem z nim dotyczące go zgłoszenia, blokady i decyzje moderacyjne; zostaje jedynie anonimowa liczba usuniętych w ten sposób zgłoszeń oczekujących. Ustawione przez Ciebie blokady są usuwane razem z Twoim kontem, a blokadę możesz zdjąć w każdej chwili. Decyzje moderacyjne zachowują identyfikator moderatora przez ten sam okres.

### "Data we process": the list gets the item (EN / PL)

- **EN:** "reports, blocks and moderation decisions (see "Reports, blocks and moderation")."
- **PL:** „zgłoszenia, blokady i decyzje moderacyjne (zob. „Zgłoszenia, blokady i moderacja”).”

---

### "Retention", row "Optional Google photo and consent record": the first sentence is replaced by
- **EN:** "The private photo copy is retained until withdrawal and completion of deletion, a moderator's decision to remove it, or account deletion."
- **PL:** „Prywatną kopię przechowujemy do czasu wycofania zgody i zakończenia jej usuwania, decyzji moderatora o jej usunięciu albo do usunięcia konta.”

---

## Resolved points
1. Texts accepted by the OWNER on 2026-11-26, including the post-review corrections above (PL is binding for Polish users; EN matches).
2. Version date: `2026-11-26` for both documents.
3. Moderators: the OWNER and the admin accounts in `ADMIN_USER_IDS`; reports are reviewed manually in the admin panel.
4. Alias timing: release A ships only the versioned a6/a3 files; the aliases switch in release B.
