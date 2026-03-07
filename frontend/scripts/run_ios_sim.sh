#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IOS_DIR="$ROOT_DIR/ios/App"
DERIVED_DATA_PATH="${DERIVED_DATA_PATH:-/tmp/alphaseeker-ios-build}"
SIMULATOR_ID="${SIMULATOR_ID:-98190544-3F47-4470-8E37-3816B6E03DCF}"
APP_BUNDLE_ID="${APP_BUNDLE_ID:-com.alphaseeker.india}"
MOBILE_API_URL="${VITE_MOBILE_API_URL:-https://alphaseeker-backend-346290058828.us-central1.run.app/api/v1}"

cd "$ROOT_DIR"
VITE_MOBILE_API_URL="$MOBILE_API_URL" npm run build
npx cap sync ios

cd "$IOS_DIR"
COPYFILE_DISABLE=1 xcodebuild \
  -workspace App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "id=$SIMULATOR_ID" \
  -derivedDataPath "$DERIVED_DATA_PATH" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build

xcrun simctl boot "$SIMULATOR_ID" || true
xcrun simctl bootstatus "$SIMULATOR_ID" -b
xcrun simctl uninstall "$SIMULATOR_ID" "$APP_BUNDLE_ID" || true
xcrun simctl install "$SIMULATOR_ID" "$DERIVED_DATA_PATH/Build/Products/Debug-iphonesimulator/App.app"
xcrun simctl launch "$SIMULATOR_ID" "$APP_BUNDLE_ID"
