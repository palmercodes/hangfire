# Hangfire 🔥

A wishlist app meets personal finance tool that helps you combat impulse purchases by making you think twice about what you really want.

## 📖 Overview

Hangfire is a React Native mobile app built with Expo that gamifies the process of managing a wishlist. Instead of buying things impulsively, you add them to your Hangfire list. Each day you get 3 points to allocate to items you want most. Over time, you'll see which items you consistently prioritize and which were just fleeting desires.

**Core Philosophy**: "Hold on... Hang fire... before you buy."

## ✨ Features

### Daily Points System
- Get **3 points per day** to allocate to your wishlist items
- Points reset daily automatically
- Upvote (↑) items you want most today
- Downvote (↓) to undo recent votes and redistribute points
- Visual feedback when you run out of points

### Reddit-Style Voting
- Upvote/downvote arrows (↑/↓) instead of traditional plus/minus
- Smooth animations when voting
- Disabled state indicators (grey when unavailable, green when active)
- Haptic feedback on interactions

### Smart Item Management
- **Product URL scraping**: Paste a product link and auto-extract name, price, and image
- **Multiple options**: Add variants/alternatives for each item (e.g., different bike models)
- **Purchase tracking**: Mark items as purchased with dates
- **Flexible sorting**: Sort by points, date added, or price
- **Image support**: Upload photos or scrape from URLs

### Data Persistence
- All data stored locally with AsyncStorage
- Survives app restarts
- Daily points automatically reset based on date

### Share Extension Support
- Share product URLs directly to Hangfire from Safari/browsers
- Auto-opens add item modal with pre-filled link
- Automatic product data scraping

## 🛠 Tech Stack

- **Framework**: React Native 0.81.4
- **Platform**: Expo 54.x
- **Language**: TypeScript
- **UI**: React Native components with custom styling
- **State**: React Hooks (useState, useCallback, useMemo, useRef)
- **Animations**: React Native Animated API
- **Storage**: @react-native-async-storage/async-storage
- **Extras**: 
  - expo-haptics for tactile feedback
  - expo-linear-gradient for visual polish
  - expo-image-picker for photo uploads
  - expo-clipboard for paste functionality

## 🚀 Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- iOS Simulator (for Mac) or Android emulator
- Expo CLI

### Installation

```bash
# Clone the repository
git clone https://github.com/palmercodes/hangfire.git
cd hangfire

# Install dependencies
npm install

# Start the development server
npm start

# Run on iOS
npm run ios

# Run on Android
npm run android
```

### Building for Production

```bash
# Build for iOS
eas build --platform ios

# Build for Android
eas build --platform android
```

## 📁 Project Structure

```
/Users/palmer.simpson/Hangfire/
├── App.tsx                 # Main application component (all logic + UI)
├── app.json               # Expo configuration
├── eas.json               # EAS Build configuration
├── package.json           # Dependencies and scripts
├── tsconfig.json          # TypeScript configuration
├── babel.config.js        # Babel configuration
├── assets/                # Images and static assets
├── ios/                   # iOS native project
└── node_modules/          # Dependencies
```

## 🏗 Architecture

### Main Component: `MainApp`

The entire app is currently contained in a single `App.tsx` file with the following structure:

#### State Management
- `items`: Array of wishlist items
- `remainingPoints`: Daily points remaining (0-3)
- `lastResetDate`: Tracks when points were last reset
- `selectedItem`: Currently viewed item in detail modal
- Various UI state (modals, forms, sorting, etc.)

#### Key Data Types

```typescript
type WishlistItem = {
  id: string;
  name: string;
  price: number;
  link?: string;
  imageUrl?: string;
  points: number;
  dateAdded: string;
  isPurchased: boolean;
  datePurchased?: string;
  options?: ItemOption[];
  selectedOptionId?: string;
}

type ItemOption = {
  id: string;
  name: string;
  price: number;
  link?: string;
  imageUrl?: string;
}
```

#### Core Functions

**Voting System**
- `addPoint(id)`: Adds a point to an item (upvote)
- `removePoint(id)`: Removes a point from an item (downvote)
- `animateUpvote(id)`: Triggers bounce animation on upvote arrow
- `animatePtsLeftEmpty()`: Animates the "pts left" badge when reaching 0

**Item Management**
- `saveNewItem()`: Creates a new wishlist item
- `confirmDelete(id)`: Deletes an item with confirmation
- `togglePurchased(id)`: Marks/unmarks item as purchased
- `updateItemImage(id)`: Changes item photo

**Options/Variants**
- `addOptionToItem()`: Adds a variant to an item
- `selectOptionAsMain()`: Sets the active variant
- `deleteOption()`: Removes a variant

**Product Scraping**
- `scrapeProductData(url)`: Extracts name, price, and image from URL
- `scrapeImageFromUrl(url)`: Finds best product image from HTML

**Sorting & Filtering**
- Supports sorting by: points (default), date added, price
- Can hide/show purchased items
- Temporarily freezes sorting during point changes for smooth UX

### Animations

The app uses React Native's `Animated` API for smooth interactions:

- **Point counter**: Scales up when voting
- **Upvote arrow**: Individual bounce animation per item
- **Pts left badge**: Double-bounce when hitting 0 points
- **Pressable feedback**: Scale transforms on button presses

### Theming

Automatic dark/light mode support based on device settings:
- Colors defined in `theme` object
- Adjusts text, backgrounds, borders dynamically
- Green accent color (`#4A7C59`) for branding

## 🎨 UI Components

### Homepage
- Header with points counter and add button
- FlatList of wishlist cards
- Each card shows: image, name, price, points, voting arrows
- Footer with sort toggle and filter switch

### Item Details Modal
- Large product image with edit button
- Name and price (editable)
- Voting arrows with point counter
- Purchase link button
- Options/variants list
- Action buttons (mark purchased, delete)

### Add Item Modal
- URL input with auto-scraping
- Manual fields: name, price, image URL
- Photo picker integration
- Scraped data preview

## 🔄 Daily Reset Logic

```typescript
function getTodayKey(): string {
  return new Date().toISOString().slice(0, 10); // yyyy-mm-dd
}
```

On app load, compares `lastResetDate` with today's date. If different, resets `remainingPoints` to 3.

## 💾 Data Persistence

All state is persisted to AsyncStorage under key `wishlist_app_state_v2`:

```typescript
type PersistedState = {
  items: WishlistItem[];
  remainingPoints: number;
  lastResetDate: string;
}
```

Auto-saves on every state change via `useEffect`.

## 🔗 Deep Linking

Supports URL scheme `hangfire://share/URL` for browser sharing:
- Opens add item modal automatically
- Pre-fills product URL
- Triggers auto-scraping

## 🎯 Future Enhancements

Potential improvements:
- [ ] Extract components into separate files
- [ ] Add user authentication
- [ ] Cloud sync across devices
- [ ] Weekly/monthly purchase reports
- [ ] Budget tracking
- [ ] Share wishlists with family/friends
- [ ] Price drop alerts
- [ ] Analytics on voting patterns

## 📝 License

Private repository - All rights reserved.

## 👤 Author

Palmer Simpson

## 🐛 Known Issues

- Product scraping depends on website HTML structure (may not work on all sites)
- No data export/backup functionality yet
- Single-file architecture makes the codebase harder to navigate

## 🤝 Contributing

This is a personal project, but suggestions are welcome! Feel free to open issues or contact the maintainer.

---

**Remember**: The best purchase is the one you don't make impulsively. Hang fire! 🔥
