# odwieszacz

Lekka aplikacja webowa do prostych przypomnien glosowych i tekstowych dla osoby z duzymi problemami pamieci. Projekt pozostaje celowo prosty: zwykle pliki statyczne, bez frameworka, bez bundlera i bez build stepu.

## Pliki projektu

- `index.html` - glowny szablon strony i struktura interfejsu.
- `styles.css` - czytelne style z duzym kontrastem i prostym ukladem mobilnym.
- `app.js` - logika przypomnien, checklisty, nagrywania audio, localStorage i lekka baza pod kolejne etapy.
- `manifest.json` - minimalna konfiguracja PWA.
- `service-worker.js` - prosty cache aplikacji offline i baza pod dalszy rozwoj.
- `icon.svg` - prosta ikona aplikacji do manifestu.
- `.gitignore` - podstawowe ignorowanie plikow systemowych i edytorow.

## Jak uruchomic lokalnie

Najprosciej uruchomic aplikacje z prostego lokalnego serwera HTTP, bo mikrofon i service worker dzialaja poprawnie na `localhost` albo `https`.

Przykladowe opcje:

1. `python -m http.server 8080`
2. prosty serwer w IDE, jesli juz go uzywasz

Potem otworz w przegladarce:

- `http://localhost:8080`

Samo otwarcie pliku `index.html` tez pokaze interfejs, ale czesc funkcji PWA i mikrofonu moze wtedy nie dzialac poprawnie, bo przegladarki traktuja to inaczej niz `localhost`.

## Co zrobiono w etapie 1

- rozdzielono kod na osobne pliki HTML, CSS i JS,
- zachowano dotychczasowe funkcje przypomnien i checklisty,
- zostawiono lokalny zapis danych w `localStorage`,
- dodano minimalny `manifest.json`,
- dodano prosty `service-worker.js`,
- przygotowano prosta baze pod powiadomienia i ekran `Zrobione`,
- zachowano brak build stepu i brak zaleznosci.

## Co warto zrobic w etapie 2

- dodac rzeczywiste powiadomienia lokalne i logike przypomnien w czasie,
- dopracowac ekran `Zrobione` i filtrowanie historii,
- dodac bezpieczniejsza obsluge starszych przegladarek,
- dodac eksport i import danych,
- przemyslec strategie czyszczenia starych nagran audio z localStorage.
