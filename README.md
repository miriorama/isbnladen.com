# isbnladen

isbnladen è un’interfaccia indipendente in HTML, CSS sorgente e JavaScript vanilla per il catalogo SBN Cloud, polo TO0, biblioteche HA (Biblioteca civica Anna Frank di Borgo San Dalmazzo) e 50 (Biblioteca civica di Cuneo).

## Avvio

Dalla cartella del progetto:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Apri http://127.0.0.1:8765. Non servono build, framework o dipendenze. È pubblicabile su un hosting statico HTTPS. Richiede un browser moderno con supporto al nesting CSS e una connessione Internet.

## Funzioni

- Ricerca per tutti i campi, titolo, autore, soggetto e ISBN, nelle biblioteche HA e 50 con un filtro OR: sono inclusi i documenti presenti in almeno una delle due, senza duplicare lo stesso BID.
- Paginazione da 12 risultati e ordinamento per rilevanza o data.
- Lista di lettura in localStorage, limitata al browser utilizzato.
- Copertine Google Books cercate tramite ISBN e caricate su richiesta del browser, nei risultati e nei nuovi salvataggi. Senza ISBN o in caso di errore rimane il segnaposto grafico.
- Query condivisibile tramite parametri `q` e `field` nell'URL.
- Disponibilità delle copie caricata dal servizio posseduto SBN separatamente per HA (ISIL CN0133) e 50 (ISIL CN0037): disponibile, in prestito, non disponibile o non comunicata. Dettagli con inventario, collocazione e data indicata dal servizio; i documenti collegati sono segnalati.
- Schede e servizi aperti tramite il permalink ufficiale `/opac/TO0/{biblioteca}/dettaglio/documento/{BID}`. La disponibilità non è dedotta dai dati bibliografici né equivale a una garanzia di prestito.
- Massimo tre richieste di disponibilità contemporanee, timeout di 12 secondi e cache in memoria di un minuto; nessuno stato viene salvato nella lista permanente. Le date SBN sono mostrate come comunicate, anche se trascorse.
- Gestione degli errori, timeout e annullamento delle richieste superate.

## Integrazione

`js/fn.js` chiama direttamente `POST https://api.cloud.sbn.it/gateway/opac-ws/search/documenti?codPolo=TO0` con un gruppo di filtri `library=HA OR library=50`. Le biblioteche sono configurate nell’array `LIBRARIES` di `js/fn.js`. L'header `Authorization: sbncloud-spa-open` è l'identificatore pubblico dell'applicazione originale, non una credenziale personale. Al 17 settembre 2026 il servizio consente CORS per questa richiesta, inclusi i relativi header.

La disponibilità usa `GET https://api.cloud.sbn.it/gateway/opac-ws/posseduto` con `bid`, `isil=CN0133` oppure `isil=CN0037`, `codPolo=TO0` e `withDisponibilita=true`. Errori e dati mancanti sono distinti da copie non disponibili. Il campo bibliografico `tag977` permette di segnalare i documenti non presenti nel catalogo di una delle due biblioteche, senza confondere assenza e prestito. La cache è separata per biblioteca e BID. I vecchi salvataggi senza `tag977` restano compatibili e vengono verificati su entrambe le biblioteche.

Il sito originale impedisce iframe tramite `X-Frame-Options: SAMEORIGIN`. L'integrazione utilizza il servizio impiegato dal frontend SBN, non un contratto API documentato: modifiche future al servizio o al CORS potrebbero richiedere un aggiornamento. In caso di errore rimane disponibile il collegamento alla ricerca ufficiale.

I dati bibliografici remoti vengono inseriti nel DOM come testo. Le copertine usano [Google Books Dynamic Links](https://developers.google.com/books/docs/dynamic-links): gli ISBN dello stesso render sono raggruppati in una richiesta JSONP, senza chiave API. Gli URL delle miniature restituiti da Google vengono caricati in HTTPS, con caricamento lazy e senza referrer. I risultati sono mantenuti in memoria durante la navigazione. Viene usato il primo ISBN-10 o ISBN-13 riconoscibile nel campo `isbn` SBN, rimuovendo spazi e trattini. Senza ISBN, miniatura o in caso di errore rimane l’emoji del libro. Le richieste hanno un timeout di 10 secondi. I vecchi salvataggi senza ISBN mantengono il segnaposto; salvando nuovamente il libro dai risultati si conserva anche l’ISBN.

Nessun analytics o font remoto; l'illustrazione iniziale è realizzata in CSS. I salvataggi contengono solo i dati bibliografici essenziali, incluso l'ISBN per le copertine.

## File

- `index.html`: struttura e interfaccia italiana.
- `css/style.css`: foglio sorgente scritto a mano, non compilato.
- `js/fn.js`: ricerca, rendering, paginazione e lista personale.

## Verifica

Sintassi JavaScript verificata con `node --check js/fn.js`. Richieste live e preflight CORS verificati sul servizio SBN. Verificati inoltre con jsdom e richieste reali: ricerca sul catalogo originale HA (68 risultati per Calvino), salvataggio/rimozione, paginazione, ordinamento, zero risultati e fallback offline. Non è stato possibile verificare visivamente il layout: nell'ambiente di lavoro non era disponibile un browser collegato.

Verifica disponibilità: test del parsing (disponibile, prestito, sconosciuto, esclusione altre biblioteche), 12 richieste live, limite di concorrenza, lista salvata e errore del servizio con risultati ancora consultabili.

Estensione a due biblioteche: test live del filtro OR HA/50, assenza di BID duplicati nella pagina, presenza di documenti esclusivi di Cuneo, richieste di disponibilità ai due ISIL, collegamenti specifici e salvataggi con localizzazioni.

Identità visiva: isbnladen, palette carta/carbone/arancio, wordmark tipografico e composizione editoriale in CSS. Nomi interni `Biblio`/`biblio-*` e chiave localStorage mantenuti per compatibilità con i salvataggi.
