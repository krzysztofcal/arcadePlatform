# Google Play Feature Graphic (1024 × 500 px) — Design Proposals & Analysis

**Linked Issue:** [#1140](https://github.com/krzysztofcal/arcadePlatform/issues/1140) / P05  
**Strategic Roadmap:** [#1138](https://github.com/krzysztofcal/arcadePlatform/issues/1138)  
**Deliverables Directory:** `docs/play-store-listing/assets/`  

---

## 1. Technical Compliance Overview

Both proposals have been generated and validated strictly against Google Play Store technical requirements:
- **Dimensions:** 1024 × 500 pixels (exact horizontal banner ratio 2.048:1).
- **Format:** 24-bit PNG (`image/png`, 8 bits per channel RGB).
- **Alpha Channel:** **None (100% opaque)** — transparency has been stripped to avoid Google Play Console upload rejections.
- **Color Space:** sRGB.
- **Safe Zone:** Kept within the central 70% bounds (≥15% horizontal and vertical margins), leaving the center clear of microscopic details that could clash with YouTube video play button overlays in the Play Store app carousel.
- **Copy Compliance:** No prohibited marketing text (*"#1"*, *"Best Poker"*, *"Free"*, *"Download Now"*).

---

## 2. Design Proposals for Owner Aesthetic Evaluation

### Propozycja 1 (Proposal 1): "Sapphire VIP Velvet"
- **Plik:** `docs/play-store-listing/assets/feature-graphic-proposal-1.png`
- **Koncepcja wizualna:** Luksusowy stół VIP w odcieniach głębokiego szafiru i granatu velvet (`#06080f` / `#0a1c3d`), dramatyczne oświetlenie żyrandolowe ze złotymi akcentami rim-light, trójwymiarowa złota typografia `ARCADE POKER` z subtelnym reliefem, rozłożone karty Royal Flush (A♠ K♠) oraz wielobarwne, błyszczące stosy żetonów (purpurowe, szmaragdowe, złote).
- **Nastrój (Vibe):** Nowoczesne, ekskluzywne kasyno, wysoka jakość renderu 3D, stonowana elegancja.
- **Kompozycja:** Wyraźny punkt centralny z logo i kartami, dynamiczne światła po bokach.

### Propozycja 2 (Proposal 2): "Emerald Palace & Canonical Arcade Chips"
- **Plik:** `docs/play-store-listing/assets/feature-graphic-proposal-2.png`
- **Koncepcja wizualna:** Bezpośrednio zakorzeniona w kanonicznych zasobach gry Arcade Poker:
  - Tło oparte na motywie stołu `emerald-palace` (`#040c08` – `#114b31`) ze złotą lamówką i łukiem filcu.
  - Oficjalne żetony z repozytorium (`poker/assets/chips/chip-*.png` – purpurowe, zielone, złote, niebieskie) ułożone w perspektywie stołu.
  - Para asów (Pocket Aces: A♠ A♥) z ostrym, wektorowym wykończeniem.
  - Precyzyjne, typograficzne logo `ARCADE POKER` z odznakami `NO-LIMIT HOLD'EM`, `ONLINE & SINGLE PLAYER` oraz kanonicznym dopiskiem `VIRTUAL CHIPS · NO CASH-OUT`.
- **Nastrój (Vibe):** Czysta, czytelna estetyka klasycznego pokera arcade, 100% spójna z UI stołu i lobby w aplikacji webowej.
- **Zalety:** Bardzo wysoka czytelność nawet przy małym skalowaniu na ekranach smartfonów w sklepie Google Play.

---

## 3. Podsumowanie do decyzji właściciela

Obie propozycje są w pełni zgodne ze specyfikacją techniczną Google Play. Przed ostatecznym wdrożeniem do konsoli Play Store prosimy o wybór preferowanego kierunku estetycznego:
1. **Kierunek A (Sapphire VIP Velvet):** Bardziej malarski, nastrojowy, głęboki luksus.
2. **Kierunek B (Emerald Palace & Canonical Arcade Chips):** Bardziej graficzny, kontrastowy, bezpośrednio odwzorowujący elementy UI stołu.
