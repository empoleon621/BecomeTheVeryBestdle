# BecomeTheVeryBestdle

A daily Pokémon challenge. Everyone gets the same six random Pokémon and faces the same four Elite Four trainers and Champion. Pick a lead before each battle. HP carries over, PP refills, and each Elite Four win gives you a choice of three rewards.

[Play BecomeTheVeryBestdle](https://empoleon621.github.io/BecomeTheVeryBestdle/)

The challenge resets at 9 p.m. Pacific. Finished wins and losses count toward the day's leaderboard. You can replay past challenges from the archive without changing their standings.

Battles run in the browser with the Pokémon Showdown simulator. The game uses Gen 9 singles mechanics and allows older Pokémon and moves through National Dex. Mega Evolution, Z-Moves, Dynamax, and Terastallization are disabled.

## Run locally

Use Node.js 22.13 or newer.

```sh
npm ci
npm run build
npm start
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). This starts the game with a local SQLite database for records. Run `npm run dev` for frontend development or `npm test` to run the tests.

## License and credits

The original project code is released under the [MIT License](LICENSE), copyright 2026 Aiden Solomon. Third-party code and assets retain their own terms. See [Third-party notices](THIRD-PARTY-NOTICES.txt) for the libraries, Pokémon sprites, artwork, fonts, and moveset sources.

BecomeTheVeryBestdle is an unofficial Pokémon fan game.
