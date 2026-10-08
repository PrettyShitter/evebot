# Подключение EVE SSO

1. Откройте https://developers.eveonline.com/applications и зарегистрируйте приложение для аутентификации ESI. Для desktop используется Authorization Code with PKCE; client secret не вводится и не встраивается.
2. Callback URL: **http://localhost:43827/callback** (точно, без дополнительного `/`). Client ID из регистрации вставьте в Настройки EVE Trader и сохраните.
3. Для основного продавца разрешите scopes: `esi-wallet.read_character_wallet.v1`, `esi-skills.read_skills.v1`, `esi-skills.read_skillqueue.v1`, `esi-characters.read_standings.v1`, `esi-markets.read_character_orders.v1`, `esi-assets.read_assets.v1`, `esi-characters.read_blueprints.v1`, `esi-industry.read_character_jobs.v1`, `esi-contracts.read_character_contracts.v1`, `esi-markets.structure_markets.v1`, `esi-search.search_structures.v1`. Для двух дополнительных персонажей нужен только wallet scope.
4. Нажмите «Подключить основного продавца». В системном браузере войдите в EVE и выберите персонажа, который будет продавать все торговые партии.
5. Ещё два раза нажмите «Подключить персонажа». Эти подключения запрашивают только wallet scope. Пароль вводится только на login.eveonline.com.
6. Нажмите «Сверить кошельки». До полного согласованного снимка бюджет не увеличивается.

Если порт 43827 занят, закройте другое окно входа. Сессия входа истекает через 5 минут. Отзыв разрешений в EVE требует кнопки «Подключить снова» рядом с нужным персонажем; приложение проверяет, что в браузере выбран именно он. Старые сделки остаются в базе. Токены зашифрованы средствами ОС в отдельной credentials-директории и не входят в SQLite backup.

При обновлении scopes основного продавца откройте «Подключить снова» для основы и подтвердите новые разрешения в EVE SSO. Уже сохранённое разрешение не расширяется автоматически. Пароль вводится только на login.eveonline.com.

Live-проверка регистрации приложения, пользовательского входа и реальных кошельков зависит от разрешений пользователя. Документ описывает scopes и поток, но не свидетельствует об успешном live-входе.
