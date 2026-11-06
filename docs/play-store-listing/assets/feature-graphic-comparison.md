# Google Play Feature Graphic (1024 × 500 px) — Design Proposals & Analysis

**Linked Issue:** [#1140](https://github.com/krzysztofcal/arcadePlatform/issues/1140) / P05  
**Strategic Roadmap:** [#1138](https://github.com/krzysztofcal/arcadePlatform/issues/1138) (Milestone M1)  
**Deliverables Directory:** `docs/play-store-listing/assets/`  
**Status:** Working Draft — Proposals Ready for Owner Review  

---

## 1. Weryfikacja techniczna plików PNG

Oba pliki zostały zweryfikowane na poziomie nagłówków IHDR pod kątem wymogów Google Play Store:
- **Rozdzielczość:** dokładnie **1024 × 500 pikseli** (stosunek boków 2.048:1).
- **Format:** rzeczywisty **24-bit Truecolor RGB PNG** (`bitDepth: 8`, `colorType: 2`, 3 kanały barwne: R, G, B).
- **Kanał alfa / Przezroczystość:** **Brak** (`hasAlpha: false`, brak przezroczystości, brak palety indeksowanej PLTE).
- **Przestrzeń barw:** sRGB.
- **Strefa bezpieczeństwa (Safe Zone):** elementy skupione w centralnych 70% kadru, bezpieczne marginesy od krawędzi (≥ 15%), optymalne pod kątem nakładek systemowych Google Play (np. przycisk play wideo).

```text
Weryfikacja nagłówka IHDR (Node.js buffer inspection):
feature-graphic-proposal-1.png: width=1024, height=500, colorType=2 (Truecolor RGB), bitDepth=8, is24BitRgb=true
feature-graphic-proposal-2.png: width=1024, height=500, colorType=2 (Truecolor RGB), bitDepth=8, is24BitRgb=true
```

---

## 2. Opis propozycji wizualnych

### Propozycja 1 (Proposal 1): "Sapphire VIP Velvet"
- **Plik:** `docs/play-store-listing/assets/feature-graphic-proposal-1.png`
- **Format:** 24-bit RGB PNG (1024 × 500 px, ~270 KB, Color Type 2).
- **Koncepcja wizualna:** Luksusowy stół VIP w odcieniach głębokiego szafiru i aksamitu, oświetlenie ze złotymi refleksami, trójwymiarowa złota typografia `ARCADE POKER`, rozłożone karty **Ace-King suited (A♠ K♠)** w kolorze pik oraz stosy żetonów pokerowych.
- **Korekta opisu układu kart:** Poprawiono pierwotny błędny opis – widoczne karty to para kart broadway w kolorze pik (**A♠ K♠ / Big Slick suited**), a nie pełny 5-kartowy poker królewski (Royal Flush).
- **Nastrój:** Styl ekskluzywnego pokoju VIP, malarski rendering atmosfery kasyna.

### Propozycja 2 (Proposal 2): "Emerald Palace & Canonical Chips" (Kierunek preferowany przez właściciela)
- **Plik:** `docs/play-store-listing/assets/feature-graphic-proposal-2.png`
- **Format:** 24-bit RGB PNG (1024 × 500 px, ~617 KB, Color Type 2).
- **Wprowadzone uproszczenia (po review):**
  - **Pozostawiono wyłącznie kluczowe elementy:**
    1. Duży, wyrazisty napis **ARCADE POKER** w złotym gradiencie z głębokim obrysem kontrastującym.
    2. Dwa asy (**Pocket Aces: A♠ i A♥**) w centralnej kompozycji.
    3. Prawdziwe żetony pokerowe z repozytorium gry (`poker/assets/chips/`) rozmieszczone po bokach stołu.
  - **Usunięto małe slogany i elementy zaśmiecające kadr:** usunięto plakietkę `NO-LIMIT HOLD'EM`, podtytuł `ONLINE & SINGLE PLAYER` oraz mały slogan `VIRTUAL CHIPS · NO CASH-OUT`.
  - **Efekt:** Maksymalna czytelność i wyrazistość logotypu, brak drobnego, nieczytelnego tekstu przy skalowaniu do miniatur w aplikacji Google Play Store na ekranach telefonów.

---

## 3. Podsumowanie do ostatecznej akceptacji

Zgodnie z decyzją review, **Propozycja 2 (Emerald Palace)** została uproszczona, pozbawiona sloganów i wyeksportowana jako prawdziwy 24-bitowy plik RGB PNG (Color Type 2). Przedstawiona do ostatecznej oceny estetycznej przed zakończeniem prac nad banerem promocyjnym.
