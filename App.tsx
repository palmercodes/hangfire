import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, FlatList, Pressable, Image, StyleSheet, useColorScheme, Alert, Animated, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView, Switch, Linking, AppState } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';

type ItemOption = {
  id: string;
  name: string;
  price: number;
  link?: string;
  imageUrl?: string;
};

type WishlistItem = {
  id: string;
  name: string;
  price: number;
  link?: string;
  imageUrl?: string;
  points: number;
  dateAdded: string; // ISO
  isPurchased: boolean;
  datePurchased?: string; // ISO
  options?: ItemOption[];
  selectedOptionId?: string; // ID of currently selected option
  pointHistory?: { date: string; points: number }[]; // Track daily point changes
};

type PersistedState = {
  items: WishlistItem[];
  remainingPoints: number;
  lastResetDate: string; // yyyy-mm-dd
};

const MAX_DAILY_POINTS = 15; // Temporarily increased for testing trending feature
const STORAGE_KEY = 'wishlist_app_state_v2';
const GREEN = '#4A7C59';

function formatPrice(price: number): string {
  if (price === 0) return 'Price TBD';
  const rounded = Math.ceil(price);
  return `$${rounded}`;
}


function getTodayKey(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function getWeeklyPoints(item: WishlistItem): number {
  if (!item.pointHistory || item.pointHistory.length === 0) {
    return 0;
  }
  
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const sevenDaysAgoKey = sevenDaysAgo.toISOString().slice(0, 10);
  
  // Calculate points added in the last 7 days
  let weeklyPoints = 0;
  for (const entry of item.pointHistory) {
    if (entry.date >= sevenDaysAgoKey) {
      weeklyPoints += entry.points;
    }
  }
  
  return weeklyPoints;
}

function getTrendingStatus(item: WishlistItem): 'none' | 'trending' | 'hot' {
  const weeklyPoints = getWeeklyPoints(item);
  if (weeklyPoints >= 10) return 'hot';
  if (weeklyPoints >= 5) return 'trending';
  return 'none';
}

async function scrapeImageFromUrl(url: string): Promise<string | null> {
  try {
    // Basic URL validation
    if (!url || !url.startsWith('http')) {
      return null;
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
      }
    });
    
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    
    // Use regex to find meta tags (more reliable than DOM parsing)
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    if (ogImageMatch && ogImageMatch[1]) {
      const imageUrl = ogImageMatch[1];
      return imageUrl.startsWith('http') ? imageUrl : new URL(imageUrl, url).toString();
    }

    // Try Twitter Card image
    const twitterImageMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    if (twitterImageMatch && twitterImageMatch[1]) {
      const imageUrl = twitterImageMatch[1];
      return imageUrl.startsWith('http') ? imageUrl : new URL(imageUrl, url).toString();
    }

    // Try to find images with src attributes using regex
    const imgMatches = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi);
    if (imgMatches) {
      let bestImage = null;
      let maxSize = 0;

      for (const imgTag of imgMatches) {
        const srcMatch = imgTag.match(/src=["']([^"']+)["']/i);
        const widthMatch = imgTag.match(/width=["']?(\d+)["']?/i);
        const heightMatch = imgTag.match(/height=["']?(\d+)["']?/i);
        
        if (srcMatch && srcMatch[1]) {
          const src = srcMatch[1];
          const width = parseInt(widthMatch?.[1] || '0');
          const height = parseInt(heightMatch?.[1] || '0');
          const size = width * height;

          // Skip very small images, data URLs, and common non-product images
          if (size > maxSize && size > 10000 && 
              !src.includes('data:') && 
              !src.includes('logo') && 
              !src.includes('icon') && 
              !src.includes('avatar') &&
              !src.includes('profile')) {
            const fullUrl = src.startsWith('http') ? src : new URL(src, url).toString();
            bestImage = fullUrl;
            maxSize = size;
          }
        }
      }

      return bestImage;
    }

    return null;
  } catch (error) {
    console.log('Image scraping failed:', error);
    return null;
  }
}

type ScrapedProductData = {
  name: string | null;
  price: number | null;
  imageUrl: string | null;
};

async function scrapeProductData(url: string): Promise<ScrapedProductData> {
  try {
    if (!url || !url.startsWith('http')) {
      return { name: null, price: null, imageUrl: null };
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1'
      }
    });
    
    if (!response.ok) {
      return { name: null, price: null, imageUrl: null };
    }

    const html = await response.text();
    
    // Extract product name
    let name = null;
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i);
    if (ogTitleMatch && ogTitleMatch[1]) {
      name = ogTitleMatch[1].trim();
    } else {
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        name = titleMatch[1].trim();
      }
    }

    // Extract price
    let price = null;
    const pricePatterns = [
      /<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]*property=["']og:price:amount["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      /\$(\d+(?:\.\d{2})?)/g,
      /price["\s]*:["\s]*\$?(\d+(?:\.\d{2})?)/i,
    ];

    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const priceValue = parseFloat(match[1]);
        if (!isNaN(priceValue) && priceValue > 0) {
          price = priceValue;
          break;
        }
      }
    }

    // Extract image
    const imageUrl = await scrapeImageFromUrl(url);

    return { name, price, imageUrl };
  } catch (error) {
    console.log('Product scraping failed:', error);
    return { name: null, price: null, imageUrl: null };
  }
}

function seedItems(): WishlistItem[] {
  // Return empty array to show empty state for new users
  return [];
}

function MainApp() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<WishlistItem[]>([]);
  const [remainingPoints, setRemainingPoints] = useState<number>(MAX_DAILY_POINTS);
  const [lastResetDate, setLastResetDate] = useState<string>(getTodayKey());
  const pointAnim = useRef(new Animated.Value(1)).current;
  const upvoteAnims = useRef<{ [key: string]: Animated.Value }>({}).current;
  const ptsLeftAnim = useRef(new Animated.Value(1)).current;
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formLink, setFormLink] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [hidePurchased, setHidePurchased] = useState(false);
  const [sortMode, setSortMode] = useState<'points' | 'date' | 'price'>('points');
  const [isSaving, setIsSaving] = useState(false);
  const [selectedItem, setSelectedItem] = useState<WishlistItem | null>(null);
  const [isAddOptionOpen, setIsAddOptionOpen] = useState(false);
  const [optionName, setOptionName] = useState('');
  const [optionPrice, setOptionPrice] = useState('');
  const [optionLink, setOptionLink] = useState('');
  const [optionImageUrl, setOptionImageUrl] = useState('');
  const [isEditingItem, setIsEditingItem] = useState(false);
  const [editItemName, setEditItemName] = useState('');
  const [editItemPrice, setEditItemPrice] = useState('');
  const [scrapedData, setScrapedData] = useState<ScrapedProductData | null>(null);
  const [isScraping, setIsScraping] = useState(false);
  const [optionScrapedData, setOptionScrapedData] = useState<ScrapedProductData | null>(null);
  const [isOptionScraping, setIsOptionScraping] = useState(false);
  const [isSortingFrozen, setIsSortingFrozen] = useState(false);
  const [frozenItems, setFrozenItems] = useState<WishlistItem[]>([]);
  const statusBarOpacity = useRef(new Animated.Value(1)).current;
  const [prevStatusMessage, setPrevStatusMessage] = useState('');

  const sortedItems = useMemo(() => {
    // Use frozen items if sorting is temporarily frozen
    const sourceItems = isSortingFrozen ? frozenItems : items;
    const filtered = hidePurchased ? sourceItems.filter(i => !i.isPurchased) : sourceItems;
    const arr = [...filtered];
    if (sortMode === 'points') arr.sort((a, b) => b.points - a.points);
    if (sortMode === 'date') arr.sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
    if (sortMode === 'price') arr.sort((a, b) => b.price - a.price);
    return arr;
  }, [items, hidePurchased, sortMode, isSortingFrozen, frozenItems]);

  const theme = useMemo(() => {
    return {
      bg: isDark ? '#0B0B0B' : '#F8FAFC',
      card: isDark ? '#171717' : '#FFFFFF',
      text: isDark ? '#F5F5F5' : '#1A1A1A',
      subtext: isDark ? '#A1A1A1' : '#6B7280',
      border: isDark ? '#2A2A2A' : '#E5E7EB',
      green: GREEN,
      headerBg: GREEN,
      headerText: '#FFFFFF',
      shadow: isDark ? '#000000' : '#00000020',
      statusBarBg: '#6B9A7A',
    };
  }, [isDark]);

  // Calculate status bar message
  const statusMessage = useMemo(() => {
    if (items.length === 0) {
      return "I'm sure there's something out there that you want to buy 😏";
    }
    
    if (remainingPoints === 0) {
      return "You've assigned all of your points for today! Congrats!";
    }
    
    if (remainingPoints === 1) {
      return "You have 1 point left to assign today!";
    }
    
    return `You have ${remainingPoints} points left to assign today!`;
  }, [items.length, remainingPoints]);

  // Fade animation when status message changes
  useEffect(() => {
    if (prevStatusMessage !== '' && prevStatusMessage !== statusMessage) {
      // Fade out then fade in
      Animated.sequence([
        Animated.timing(statusBarOpacity, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(statusBarOpacity, {
          toValue: 1,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }
    setPrevStatusMessage(statusMessage);
  }, [statusMessage, prevStatusMessage, statusBarOpacity]);

  // Check if we need to reset points based on date
  const checkAndResetDailyPoints = useCallback(async () => {
    const today = getTodayKey();
    if (lastResetDate !== today) {
      setRemainingPoints(MAX_DAILY_POINTS);
      setLastResetDate(today);
    }
  }, [lastResetDate]);

  useEffect(() => {
    const load = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed: PersistedState = JSON.parse(raw);
          const today = getTodayKey();
          setItems(parsed.items ?? []);
          if (parsed.lastResetDate === today) {
            setRemainingPoints(parsed.remainingPoints ?? MAX_DAILY_POINTS);
          } else {
            setRemainingPoints(MAX_DAILY_POINTS);
          }
          setLastResetDate(today);
        } else {
          setItems(seedItems());
          setRemainingPoints(MAX_DAILY_POINTS);
          setLastResetDate(getTodayKey());
        }
      } catch (e) {
        // best-effort: start fresh
        setItems(seedItems());
        setRemainingPoints(MAX_DAILY_POINTS);
        setLastResetDate(getTodayKey());
      }
    };
    load();
  }, []);

  // Listen for app state changes to reset points when app becomes active on a new day
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        checkAndResetDailyPoints();
      }
    });

    return () => {
      subscription?.remove();
    };
  }, [checkAndResetDailyPoints]);

  // Handle deep links from browser sharing
  useEffect(() => {
    const handleDeepLink = (url: string) => {
      console.log('Received deep link:', url);
      
      // Handle hangfire://share/URL format
      if (url.includes('hangfire://share/')) {
        const sharedUrl = url.replace('hangfire://share/', '');
        if (sharedUrl && sharedUrl.startsWith('http')) {
          setFormLink(sharedUrl);
          setIsAddOpen(true);
          // Auto-trigger URL scraping
          setTimeout(() => {
            handleUrlChange(sharedUrl);
          }, 500);
        }
      }
    };

    // Listen for deep links when app is already running
    const subscription = Linking.addEventListener('url', ({ url }) => {
      handleDeepLink(url);
    });

    // Handle deep link when app is opened from closed state
    Linking.getInitialURL().then((url) => {
      if (url) {
        handleDeepLink(url);
      }
    });

    return () => {
      subscription?.remove();
    };
  }, []);

  useEffect(() => {
    const persist = async () => {
      try {
        const data: PersistedState = {
          items,
          remainingPoints,
          lastResetDate,
        };
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        // ignore
      }
    };
    persist();
  }, [items, remainingPoints, lastResetDate]);

  const animatePoints = useCallback(() => {
    pointAnim.setValue(1);
    Animated.sequence([
      Animated.timing(pointAnim, { toValue: 1.12, duration: 110, useNativeDriver: true }),
      Animated.spring(pointAnim, { toValue: 1, useNativeDriver: true, friction: 4 }),
    ]).start();
  }, [pointAnim]);

  const animatePtsLeftEmpty = useCallback(() => {
    ptsLeftAnim.setValue(1);
    Animated.sequence([
      Animated.timing(ptsLeftAnim, { toValue: 1.15, duration: 100, useNativeDriver: true }),
      Animated.spring(ptsLeftAnim, { toValue: 1, useNativeDriver: true, friction: 3, tension: 150 }),
      Animated.timing(ptsLeftAnim, { toValue: 1.08, duration: 80, useNativeDriver: true }),
      Animated.spring(ptsLeftAnim, { toValue: 1, useNativeDriver: true, friction: 3 }),
    ]).start();
  }, [ptsLeftAnim]);

  const animateUpvote = useCallback((id: string) => {
    // Initialize animation value for this item if it doesn't exist
    if (!upvoteAnims[id]) {
      upvoteAnims[id] = new Animated.Value(1);
    }
    
    const anim = upvoteAnims[id];
    anim.setValue(1);
    Animated.sequence([
      Animated.spring(anim, { 
        toValue: 1.4, 
        friction: 3,
        tension: 200,
        useNativeDriver: true 
      }),
      Animated.spring(anim, { 
        toValue: 1, 
        friction: 3,
        tension: 100,
        useNativeDriver: true 
      }),
    ]).start();
  }, [upvoteAnims]);

  const addPoint = useCallback((id: string) => {
    // Only freeze sorting if we're sorting by points
    if (sortMode === 'points') {
      setIsSortingFrozen(true);
      setFrozenItems(items);
    }

    setItems(prev => {
      if (remainingPoints <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return prev;
      }
      const today = getTodayKey();
      const next = prev.map(it => {
        if (it.id === id) {
          const newPointHistory = [...(it.pointHistory || [])];
          const todayEntry = newPointHistory.find(entry => entry.date === today);
          if (todayEntry) {
            todayEntry.points += 1;
          } else {
            newPointHistory.push({ date: today, points: 1 });
          }
          return { ...it, points: it.points + 1, pointHistory: newPointHistory };
        }
        return it;
      });
      
      // Update selectedItem if it's the same item
      if (selectedItem?.id === id) {
        const updatedItem = next.find(it => it.id === id);
        if (updatedItem) {
          setSelectedItem(updatedItem);
        }
      }
      
      return next;
    });
    const newRemainingPoints = remainingPoints > 0 ? remainingPoints - 1 : remainingPoints;
    setRemainingPoints(newRemainingPoints);
    animatePoints();
    animateUpvote(id);
    if (remainingPoints > 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    
    // Animate the "pts left" label when hitting 0
    if (newRemainingPoints === 0) {
      animatePtsLeftEmpty();
    }

    // Unfreeze sorting after a delay
    if (sortMode === 'points') {
      setTimeout(() => {
        setIsSortingFrozen(false);
      }, 1000); // 1 second delay
    }
  }, [remainingPoints, animatePoints, animateUpvote, animatePtsLeftEmpty, sortMode, items, selectedItem]);

  const removePoint = useCallback((id: string) => {
    // Only freeze sorting if we're sorting by points
    if (sortMode === 'points') {
      setIsSortingFrozen(true);
      setFrozenItems(items);
    }

    setItems(prev => {
      const target = prev.find(it => it.id === id);
      if (!target || target.points <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return prev;
      }
      const today = getTodayKey();
      const next = prev.map(it => {
        if (it.id === id) {
          const newPointHistory = [...(it.pointHistory || [])];
          const todayEntry = newPointHistory.find(entry => entry.date === today);
          if (todayEntry) {
            todayEntry.points = Math.max(0, todayEntry.points - 1);
          } else {
            newPointHistory.push({ date: today, points: -1 });
          }
          return { ...it, points: Math.max(0, it.points - 1), pointHistory: newPointHistory };
        }
        return it;
      });
      
      // Update selectedItem if it's the same item
      if (selectedItem?.id === id) {
        const updatedItem = next.find(it => it.id === id);
        if (updatedItem) {
          setSelectedItem(updatedItem);
        }
      }
      
      return next;
    });
    setRemainingPoints(p => (p < MAX_DAILY_POINTS ? p + 1 : p));
    animatePoints();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Unfreeze sorting after a delay
    if (sortMode === 'points') {
      setTimeout(() => {
        setIsSortingFrozen(false);
      }, 1000); // 1 second delay
    }
  }, [animatePoints, sortMode, items, selectedItem]);

  const resetDailyPoints = useCallback(() => {
    setRemainingPoints(MAX_DAILY_POINTS);
    setLastResetDate(getTodayKey());
  }, []);

  const confirmDelete = useCallback((id: string) => {
    Alert.alert('Delete item', 'Are you sure you want to delete this item?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        setItems(prev => prev.filter(it => it.id !== id));
      } },
    ]);
  }, []);

  const togglePurchased = useCallback((id: string) => {
    setItems(prev => prev.map(it => {
      if (it.id !== id) return it;
      const nextPurchased = !it.isPurchased;
      return {
        ...it,
        isPurchased: nextPurchased,
        datePurchased: nextPurchased ? new Date().toISOString() : undefined,
      };
    }));
  }, []);

  const openItemDetail = useCallback((item: WishlistItem) => {
    setSelectedItem(item);
  }, []);

  const closeItemDetail = useCallback(() => {
    setSelectedItem(null);
  }, []);

  const openPurchaseLink = useCallback(async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert('Error', 'Could not open the purchase link.');
    }
  }, []);

  const getCurrentDisplayItem = useCallback((item: WishlistItem) => {
    if (item.options && item.selectedOptionId) {
      const selectedOption = item.options.find(opt => opt.id === item.selectedOptionId);
      if (selectedOption) {
        return {
          ...item,
          name: selectedOption.name,
          price: selectedOption.price,
          link: selectedOption.link,
          imageUrl: selectedOption.imageUrl,
        };
      }
    }
    return item;
  }, []);

  const addOptionToItem = useCallback((itemId: string, option: ItemOption) => {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const updatedOptions = [...(item.options || []), option];
      return {
        ...item,
        options: updatedOptions,
        // If this is the first option, select it as main
        selectedOptionId: item.options?.length === 0 ? option.id : item.selectedOptionId,
      };
    }));
    
    // Update selectedItem if it's the same item
    if (selectedItem?.id === itemId) {
      setSelectedItem(prev => {
        if (!prev) return null;
        const updatedOptions = [...(prev.options || []), option];
        return {
          ...prev,
          options: updatedOptions,
          selectedOptionId: prev.options?.length === 0 ? option.id : prev.selectedOptionId,
        };
      });
    }
  }, [selectedItem]);

  const selectOptionAsMain = useCallback((itemId: string, optionId: string) => {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      return { ...item, selectedOptionId: optionId };
    }));
    
    // Update selectedItem if it's the same item
    if (selectedItem?.id === itemId) {
      setSelectedItem(prev => prev ? { ...prev, selectedOptionId: optionId } : null);
    }
  }, [selectedItem]);

  const deleteOption = useCallback((itemId: string, optionId: string) => {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const updatedOptions = (item.options || []).filter(opt => opt.id !== optionId);
      const newSelectedOptionId = item.selectedOptionId === optionId 
        ? (updatedOptions.length > 0 ? updatedOptions[0].id : undefined)
        : item.selectedOptionId;
      
      return {
        ...item,
        options: updatedOptions,
        selectedOptionId: newSelectedOptionId,
      };
    }));
    
    // Update selectedItem if it's the same item
    if (selectedItem?.id === itemId) {
      setSelectedItem(prev => {
        if (!prev) return null;
        const updatedOptions = (prev.options || []).filter(opt => opt.id !== optionId);
        const newSelectedOptionId = prev.selectedOptionId === optionId 
          ? (updatedOptions.length > 0 ? updatedOptions[0].id : undefined)
          : prev.selectedOptionId;
        
        return {
          ...prev,
          options: updatedOptions,
          selectedOptionId: newSelectedOptionId,
        };
      });
    }
  }, [selectedItem]);

  const updateItemImage = useCallback(async (itemId: string) => {
    Alert.alert(
      'Change Image',
      'Choose an option',
      [
        {
          text: 'Camera',
          onPress: async () => {
            const { status } = await ImagePicker.requestCameraPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission needed', 'Camera permission is required.');
              return;
            }
            const res = await ImagePicker.launchCameraAsync({ 
              mediaTypes: ImagePicker.MediaTypeOptions.Images, 
              quality: 0.8 
            });
            if (!res.canceled && res.assets && res.assets[0]) {
              const updatedItem = { ...selectedItem!, imageUrl: res.assets![0].uri };
              setItems(prev => prev.map(item => 
                item.id === itemId 
                  ? updatedItem
                  : item
              ));
              setSelectedItem(updatedItem);
            }
          }
        },
        {
          text: 'Photo Library',
          onPress: async () => {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
              Alert.alert('Permission needed', 'Media library permission is required.');
              return;
            }
            const res = await ImagePicker.launchImageLibraryAsync({ 
              mediaTypes: ImagePicker.MediaTypeOptions.Images, 
              quality: 0.8 
            });
            if (!res.canceled && res.assets && res.assets[0]) {
              const updatedItem = { ...selectedItem!, imageUrl: res.assets![0].uri };
              setItems(prev => prev.map(item => 
                item.id === itemId 
                  ? updatedItem
                  : item
              ));
              setSelectedItem(updatedItem);
            }
          }
        },
        {
          text: 'Remove Image',
          style: 'destructive',
          onPress: () => {
            const updatedItem = { ...selectedItem!, imageUrl: undefined };
            setItems(prev => prev.map(item => 
              item.id === itemId 
                ? updatedItem
                : item
            ));
            setSelectedItem(updatedItem);
          }
        },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  }, [selectedItem]);

  const openAdd = useCallback(() => {
    setFormName('');
    setFormPrice('');
    setFormLink('');
    setFormImageUrl('');
    setScrapedData(null);
    setIsAddOpen(true);
  }, []);

  const handleUrlChange = useCallback(async (url: string) => {
    setFormLink(url);
    
    if (url.trim() && url.startsWith('http')) {
      setIsScraping(true);
      try {
        const data = await scrapeProductData(url.trim());
        setScrapedData(data);
        
        // Auto-fill form fields if data was found
        if (data.name) {
          setFormName(data.name);
        }
        if (data.price !== null) {
          setFormPrice(data.price.toString());
        }
        if (data.imageUrl) {
          setFormImageUrl(data.imageUrl);
        }
      } catch (error) {
        console.log('Scraping failed:', error);
        setScrapedData(null);
      } finally {
        setIsScraping(false);
      }
    } else {
      setScrapedData(null);
    }
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const clipboardText = await Clipboard.getStringAsync();
      if (clipboardText && clipboardText.trim()) {
        // Trigger the URL change handler to start scraping
        await handleUrlChange(clipboardText.trim());
      } else {
        Alert.alert('Clipboard Empty', 'No text found in clipboard to paste.');
      }
    } catch (error) {
      console.log('Paste failed:', error);
      Alert.alert('Paste Failed', 'Could not access clipboard. Please paste manually.');
    }
  }, [handleUrlChange]);

  const openAddOption = useCallback(() => {
    setOptionName('');
    setOptionPrice('');
    setOptionLink('');
    setOptionImageUrl('');
    setOptionScrapedData(null);
    setIsAddOptionOpen(true);
  }, []);

  const handleOptionPaste = useCallback(async () => {
    try {
      const clipboardText = await Clipboard.getStringAsync();
      if (clipboardText && clipboardText.trim()) {
        // Trigger the option URL change handler to start scraping
        await handleOptionUrlChange(clipboardText.trim());
      } else {
        Alert.alert('Clipboard Empty', 'No text found in clipboard to paste.');
      }
    } catch (error) {
      console.log('Option paste failed:', error);
      Alert.alert('Paste Failed', 'Could not access clipboard. Please paste manually.');
    }
  }, []);

  const handleOptionUrlChange = useCallback(async (url: string) => {
    setOptionLink(url);
    
    if (url.trim() && url.startsWith('http')) {
      setIsOptionScraping(true);
      try {
        const data = await scrapeProductData(url.trim());
        setOptionScrapedData(data);
        
        // Auto-fill option form fields if data was found
        if (data.name) {
          setOptionName(data.name);
        }
        if (data.price !== null) {
          setOptionPrice(data.price.toString());
        }
        if (data.imageUrl) {
          setOptionImageUrl(data.imageUrl);
        }
      } catch (error) {
        console.log('Option scraping failed:', error);
        setOptionScrapedData(null);
      } finally {
        setIsOptionScraping(false);
      }
    } else {
      setOptionScrapedData(null);
    }
  }, []);

  const startEditingItem = useCallback(() => {
    if (selectedItem) {
      setEditItemName(selectedItem.name);
      setEditItemPrice(selectedItem.price ? selectedItem.price.toString() : '');
      setIsEditingItem(true);
    }
  }, [selectedItem]);

  const cancelEditingItem = useCallback(() => {
    setIsEditingItem(false);
    setEditItemName('');
    setEditItemPrice('');
  }, []);

  const saveItemEdit = useCallback(() => {
    if (!selectedItem) return;
    
    const name = editItemName.trim();
    const price = editItemPrice.trim() ? parseFloat(editItemPrice) : undefined;
    
    if (!name) {
      Alert.alert('Name required', 'Please enter an item name.');
      return;
    }
    
    if (price !== undefined && (isNaN(price) || price < 0)) {
      Alert.alert('Invalid price', 'Enter a valid non-negative price.');
      return;
    }

    setItems(prev => prev.map(item => 
      item.id === selectedItem.id 
        ? { ...item, name, price: price || 0 }
        : item
    ));
    
    setSelectedItem(prev => prev ? { ...prev, name, price: price || 0 } : null);
    setIsEditingItem(false);
  }, [selectedItem, editItemName, editItemPrice]);

  const saveNewOption = useCallback(async () => {
    const name = optionName.trim();
    const price = optionPrice.trim() ? parseFloat(optionPrice) : 0;
    if (!name) {
      Alert.alert('Name required', 'Please enter an option name.');
      return;
    }
    if (optionPrice.trim() && (isNaN(price) || price < 0)) {
      Alert.alert('Invalid price', 'Enter a valid non-negative price.');
      return;
    }

    if (!selectedItem) return;

    setIsSaving(true);
    let imageUrl = optionImageUrl.trim() || undefined;
    
    // If no image URL provided but we have a purchase link, try to scrape an image
    if (!imageUrl && optionLink.trim()) {
      try {
        const scrapedImage = await scrapeImageFromUrl(optionLink.trim());
        if (scrapedImage) {
          imageUrl = scrapedImage;
        }
      } catch (error) {
        console.log('Image scraping failed:', error);
      }
    }

    const newOption: ItemOption = {
      id: String(Date.now()),
      name,
      price,
      link: optionLink.trim() || undefined,
      imageUrl,
    };

    addOptionToItem(selectedItem.id, newOption);
    setIsSaving(false);
    setIsAddOptionOpen(false);
  }, [optionName, optionPrice, optionLink, optionImageUrl, selectedItem, addOptionToItem]);

  const pickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Media library permission is required.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!res.canceled && res.assets && res.assets[0]) {
      setFormImageUrl(res.assets[0].uri);
    }
  }, []);

  const pickOptionImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Media library permission is required.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (!res.canceled && res.assets && res.assets[0]) {
      setOptionImageUrl(res.assets[0].uri);
    }
  }, []);

  const saveNewItem = useCallback(async () => {
    const name = formName.trim();
    const price = formPrice.trim() ? parseFloat(formPrice) : 0;
    if (!name) {
      Alert.alert('Name required', 'Please enter an item name.');
      return;
    }
    if (formPrice.trim() && (isNaN(price) || price < 0)) {
      Alert.alert('Invalid price', 'Enter a valid non-negative price.');
      return;
    }

    setIsSaving(true);
    let imageUrl = formImageUrl.trim() || undefined;
    
    // If no image URL provided but we have a purchase link, try to scrape an image
    if (!imageUrl && formLink.trim()) {
      try {
        const scrapedImage = await scrapeImageFromUrl(formLink.trim());
        if (scrapedImage) {
          imageUrl = scrapedImage;
        }
      } catch (error) {
        console.log('Image scraping failed:', error);
      }
    }

    const newItem: WishlistItem = {
      id: String(Date.now()),
      name,
      price,
      link: formLink.trim() || undefined,
      imageUrl,
      points: 0,
      dateAdded: new Date().toISOString(),
      isPurchased: false,
    };
    setItems(prev => [newItem, ...prev]);
    setIsSaving(false);
    setIsAddOpen(false);
  }, [formName, formPrice, formLink, formImageUrl]);

  const renderEmptyState = useCallback(() => {
    return (
      <View style={styles.emptyStateContainer}>
        <Text style={[styles.emptyStateEmoji, { color: theme.subtext }]}>📝</Text>
        <Text style={[styles.emptyStateTitle, { color: theme.text }]}>
          Impulse purchases, begone!
        </Text>
        <Text style={[styles.emptyStateSubtitle, { color: theme.subtext }]}>
          Next time you want to buy something, add it to this list instead. Hold on.. Hang fire.. Every day you'll get 3 points you can assign to the items you want most. Over time you can see which items you really want, and which ones you only thought you wanted for a day.
        </Text>
        <Text style={[styles.emptyStateAction, { color: theme.text }]}>
          Add your first item using ＋ button above
        </Text>
        <View style={styles.emptyStateArrow}>
          <Text style={[styles.emptyStateArrowText, { color: theme.green }]}>☝️</Text>
        </View>
      </View>
    );
  }, [theme]);

  const getUpvoteAnim = useCallback((id: string) => {
    if (!upvoteAnims[id]) {
      upvoteAnims[id] = new Animated.Value(1);
    }
    return upvoteAnims[id];
  }, [upvoteAnims]);

  const renderItem = useCallback(({ item }: { item: WishlistItem }) => {
    const displayItem = getCurrentDisplayItem(item);
    const hasOptions = item.options && item.options.length > 0;
    const upvoteAnim = getUpvoteAnim(item.id);
    const trendingStatus = getTrendingStatus(item);
    const weeklyPoints = getWeeklyPoints(item);
    
    return (
      <Pressable
        onPress={() => openItemDetail(item)}
        style={[
          styles.card,
          {
            backgroundColor: theme.card,
            borderColor: theme.border,
            opacity: item.isPurchased ? 0.9 : 1,
            shadowColor: theme.shadow,
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.1,
            shadowRadius: 8,
            elevation: 3,
          },
        ]}
      > 
        {item.isPurchased ? (
          <LinearGradient
            colors={['rgba(74,124,89,0.10)', 'rgba(74,124,89,0.00)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.gradientOverlay}
          />
        ) : null}
        {item.isPurchased ? (
          <View style={styles.purchasedBadge}> 
            <Text style={styles.purchasedBadgeText}>🛒 {item.datePurchased ? new Date(item.datePurchased).toLocaleDateString() : ''}</Text>
          </View>
        ) : null}
        {hasOptions && (
          <View style={styles.optionsBadge}>
            <Text style={styles.optionsBadgeText}>{item.options!.length} options</Text>
          </View>
        )}
        {trendingStatus === 'hot' && !item.isPurchased && (
          <View style={[styles.trendingBadge, { right: 12, top: 12 }]}>
            <Text style={styles.trendingBadgeText}>🔥 Hot</Text>
          </View>
        )}
        {trendingStatus === 'trending' && !item.isPurchased && (
          <View style={[styles.trendingBadge, { right: 12, top: 12, backgroundColor: theme.green }]}>
            <Text style={styles.trendingBadgeText}>📈 Trending</Text>
          </View>
        )}
        <View style={styles.row}>
          <Image
            source={{ uri: displayItem.imageUrl || 'https://via.placeholder.com/96' }}
            style={[styles.image, item.isPurchased ? { opacity: 0.6 } : null]}
            resizeMode="contain"
          />
          <View style={{ flex: 1, marginLeft: 12, paddingRight: (item.isPurchased || hasOptions || trendingStatus !== 'none') ? 100 : 0 }}>
            <View style={[styles.row, { alignItems: 'center' }]}> 
              <Text
                style={[
                  styles.title,
                  {
                    color: item.isPurchased ? theme.subtext : theme.text,
                  },
                ]}
                numberOfLines={2}
              >
                {displayItem.name}
              </Text>
              {item.isPurchased ? (
                <Text style={{ marginLeft: 8, color: theme.green }}>✓</Text>
              ) : null}
            </View>
            <Text style={{ color: theme.subtext, marginTop: 2 }}>📅 {new Date(item.dateAdded).toLocaleDateString()}</Text>
            {weeklyPoints > 0 && (
              <Text style={{ 
                color: trendingStatus === 'hot' ? '#FF6B35' : trendingStatus === 'trending' ? theme.green : theme.subtext, 
                marginTop: 2, 
                fontSize: 12,
                fontWeight: '600'
              }}>
                {weeklyPoints} pts this week
              </Text>
            )}
            <Text style={{ color: theme.subtext, marginTop: 2, textAlign: 'right' }}>
              {formatPrice(displayItem.price)}
            </Text>
          </View>
        </View>

        <View style={[styles.pointsRow]}> 
          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              addPoint(item.id);
            }}
            disabled={remainingPoints <= 0}
            style={({ pressed }) => [
              styles.circleBtn,
              { 
                borderColor: theme.green, 
                opacity: pressed ? 0.8 : 1, 
                backgroundColor: remainingPoints > 0 ? 'transparent' : theme.border,
                shadowColor: theme.shadow,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.15,
                shadowRadius: 4,
                elevation: 2,
              },
            ]}
          >
            <Animated.Text style={[
              styles.btnText, 
              { 
                color: remainingPoints > 0 ? theme.green : theme.subtext,
                transform: [{ scale: upvoteAnim }]
              }
            ]}>
              ↑
            </Animated.Text>
          </Pressable>

          <Animated.Text style={[styles.pointsText, { color: theme.text, transform: [{ scale: pointAnim }] }]}>
            {item.points}
          </Animated.Text>

          <Pressable
            onPress={(e) => {
              e.stopPropagation();
              removePoint(item.id);
            }}
            disabled={item.points <= 0 || remainingPoints >= MAX_DAILY_POINTS}
            style={({ pressed }) => [
              styles.circleBtn, 
              { 
                borderColor: theme.green, 
                opacity: pressed ? 0.8 : 1,
                backgroundColor: (item.points > 0 && remainingPoints < MAX_DAILY_POINTS) ? 'transparent' : theme.border,
                transform: [{ scale: pressed ? 0.95 : 1 }],
                shadowColor: theme.shadow,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.15,
                shadowRadius: 4,
                elevation: 2,
              }
            ]}
          >
            <Text style={[styles.btnText, { color: (item.points > 0 && remainingPoints < MAX_DAILY_POINTS) ? theme.green : theme.subtext }]}>↓</Text>
          </Pressable>
        </View>

        <View style={[styles.actionsRow]}> 
          <Pressable onPress={() => togglePurchased(item.id)} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
            <Text style={{ color: theme.subtext }}>{item.isPurchased ? `Unmark purchased` : 'Mark purchased'}</Text>
          </Pressable>
          <Pressable onPress={() => confirmDelete(item.id)} style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
            <Text style={{ color: '#EF4444' }}>Delete</Text>
          </Pressable>
        </View>
      </Pressable>
    );
  }, [addPoint, removePoint, confirmDelete, togglePurchased, theme, remainingPoints, pointAnim, openItemDetail, getCurrentDisplayItem, getUpvoteAnim]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      
      <LinearGradient
        colors={isDark ? ['#0B0B0B', '#1A1A1A'] : ['#F8FAFC', '#F1F5F9']}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[styles.header, { backgroundColor: GREEN }]}>
        <View style={styles.headerTitleContainer}>
          <Text style={[styles.headerTitle, { color: isDark ? 'white' : 'white' }]}>Hangfire 🔥</Text>
        </View>
        <View style={styles.headerActions}> 
          <Animated.View style={[
            styles.pointsDisplay, 
            { 
              backgroundColor: isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.2)',
              transform: [{ scale: ptsLeftAnim }]
            }
          ]}>
            <Text style={styles.pointsEmoji}>💎</Text>
            <Text style={{ color: isDark ? 'white' : 'white', fontSize: 13, fontWeight: '500' }}>
              {remainingPoints} pt{remainingPoints !== 1 ? 's' : ''} left
            </Text>
          </Animated.View>
          <Pressable style={[styles.addBtn, { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(255, 255, 255, 0.2)' }]} onPress={openAdd}>
            <Text style={[styles.addBtnText, { color: isDark ? 'white' : 'white' }]}>＋</Text>
          </Pressable>
        </View>
      </View>

      {/* Status Bar */}
      <Animated.View style={[
        styles.statusBar, 
        { 
          backgroundColor: theme.statusBarBg,
          opacity: statusBarOpacity,
        }
      ]}>
        <Text style={styles.statusBarText}>{statusMessage}</Text>
      </Animated.View>

      <FlatList
        contentContainerStyle={{ padding: 16, paddingBottom: 120, flexGrow: 1 }}
        data={sortedItems}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListEmptyComponent={renderEmptyState}
      />

      <View style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.bg, paddingBottom: Math.max(insets.bottom, 12) }]}> 
        <Pressable style={styles.sortButton} onPress={() => {
          setSortMode(m => (m === 'points' ? 'date' : m === 'date' ? 'price' : 'points'));
        }}>
          <Text style={[styles.sortButtonText, { color: theme.text }]}>
            {sortMode === 'points' ? 'Sort: Points' : sortMode === 'date' ? 'Sort: Date' : 'Sort: Price'}
          </Text>
        </Pressable>
        <View style={styles.toggleContainer}>
          <Text style={[styles.toggleLabel, { color: theme.text }]}>
            Include Purchased
          </Text>
          <Switch
            value={!hidePurchased}
            onValueChange={(value) => setHidePurchased(!value)}
            trackColor={{ false: '#E5E7EB', true: GREEN }}
            thumbColor={hidePurchased ? '#9CA3AF' : '#FFFFFF'}
            ios_backgroundColor="#E5E7EB"
          />
        </View>
      </View>

      <Modal visible={isAddOpen} animationType="slide" onRequestClose={() => setIsAddOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
              <Text style={[styles.modalTitle, { color: theme.text }]}>Add Item</Text>
              
              <Text style={[styles.inputLabel, { color: theme.text }]}>Purchase Link (optional)</Text>
              <View style={styles.inputWithButton}>
                <TextInput
                  value={formLink}
                  onChangeText={handleUrlChange}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="https://..."
                  placeholderTextColor={theme.subtext}
                  style={[styles.input, { color: theme.text, borderColor: theme.border, flex: 1, marginRight: 8 }]}
                />
                <Pressable onPress={handlePaste} style={[styles.pasteButton, { borderColor: theme.border }]}>
                  <Text style={[styles.pasteButtonText, { color: theme.text }]}>Paste</Text>
                </Pressable>
              </View>

              {isScraping && (
                <View style={styles.scrapingIndicator}>
                  <Text style={[styles.scrapingText, { color: theme.subtext }]}>🔍 Scraping product data...</Text>
                </View>
              )}

              {scrapedData && (scrapedData.name || scrapedData.price !== null || scrapedData.imageUrl) && (
                <View style={[styles.scrapedPreview, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={[styles.scrapedPreviewTitle, { color: theme.text }]}>✨ Scraped Data</Text>
                  {scrapedData.imageUrl && (
                    <Image source={{ uri: scrapedData.imageUrl }} style={styles.scrapedImage} resizeMode="contain" />
                  )}
                  <Text style={[styles.scrapedPreviewText, { color: theme.text }]}>
                    {scrapedData.name && `Name: ${scrapedData.name}`}
                    {scrapedData.price !== null && `\nPrice: ${formatPrice(scrapedData.price)}`}
                    {scrapedData.imageUrl && '\nImage: Found'}
                  </Text>
                </View>
              )}

              <Text style={[styles.inputLabel, { color: theme.text }]}>Name</Text>
              <TextInput
                value={formName}
                onChangeText={setFormName}
                placeholder="Item name"
                placeholderTextColor={theme.subtext}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />

              <Text style={[styles.inputLabel, { color: theme.text }]}>Price (optional)</Text>
              <TextInput
                value={formPrice}
                onChangeText={setFormPrice}
                keyboardType="decimal-pad"
                placeholder="50 (optional)"
                placeholderTextColor={theme.subtext}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />

              <Text style={[styles.inputLabel, { color: theme.text }]}>Image URL</Text>
              <TextInput
                value={formImageUrl}
                onChangeText={setFormImageUrl}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="https:// or file path"
                placeholderTextColor={theme.subtext}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />

              <Pressable onPress={pickImage} style={({ pressed }) => [styles.pickBtn, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ color: theme.text }}>Pick from Photos</Text>
              </Pressable>

              {formImageUrl ? (
                <Image source={{ uri: formImageUrl }} style={{ width: '100%', height: 180, borderRadius: 12, marginTop: 12 }} resizeMode="contain" />
              ) : null}

              <View style={{ height: 16 }} />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Pressable onPress={() => setIsAddOpen(false)} style={({ pressed }) => [styles.cancelBtn, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
                  <Text style={{ color: theme.text }}>Cancel</Text>
                </Pressable>
                <Pressable 
                  onPress={saveNewItem} 
                  disabled={isSaving}
                  style={({ pressed }) => [styles.saveBtn, { backgroundColor: GREEN, opacity: pressed ? 0.8 : 1 }]}
                >
                  <Text style={{ color: 'white', fontWeight: '700' }}>
                    {isSaving ? 'Scraping...' : 'Save'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Item Detail Modal */}
      <Modal 
        visible={!!selectedItem && !isAddOptionOpen} 
        animationType="slide" 
        onRequestClose={closeItemDetail}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
          <StatusBar style={isDark ? 'light' : 'dark'} />
          
          {selectedItem && (() => {
            const displayItem = getCurrentDisplayItem(selectedItem);
            return (
              <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
                {/* Header with back button */}
                <View style={[styles.detailHeader, { borderBottomColor: theme.border }]}>
                  <Pressable onPress={closeItemDetail} style={styles.backButton}>
                    <Text style={[styles.backButtonText, { color: theme.text }]}>← Back</Text>
                  </Pressable>
                  <Text style={[styles.detailHeaderTitle, { color: theme.text }]}>Item Details</Text>
                  <View style={{ width: 60 }} />
                </View>

                {/* Large image */}
                <View style={styles.detailImageContainer}>
                  <Image
                    source={{ uri: displayItem.imageUrl || 'https://via.placeholder.com/400' }}
                    style={styles.detailImage}
                    resizeMode="contain"
                  />
                  {selectedItem.isPurchased && (
                    <View style={styles.detailPurchasedBadge}>
                      <Text style={styles.detailPurchasedText}>✓ Purchased</Text>
                    </View>
                  )}
                  <Pressable
                    onPress={() => updateItemImage(selectedItem.id)}
                    style={({ pressed }) => [
                      styles.changeImageButton,
                      { opacity: pressed ? 0.8 : 1 }
                    ]}
                  >
                    <Text style={styles.changeImageText}>📷 Edit</Text>
                  </Pressable>
                </View>

                {/* Content */}
                <View style={[styles.detailContent, { backgroundColor: theme.card }]}>
                  {isEditingItem ? (
                    <View>
                      <Text style={[styles.inputLabel, { color: theme.text }]}>Name</Text>
                      <TextInput
                        value={editItemName}
                        onChangeText={setEditItemName}
                        placeholder="Item name"
                        placeholderTextColor={theme.subtext}
                        style={[styles.input, { color: theme.text, borderColor: theme.border, marginBottom: 12 }]}
                      />
                      <Text style={[styles.inputLabel, { color: theme.text }]}>Price (optional)</Text>
                      <TextInput
                        value={editItemPrice}
                        onChangeText={setEditItemPrice}
                        keyboardType="decimal-pad"
                        placeholder="50"
                        placeholderTextColor={theme.subtext}
                        style={[styles.input, { color: theme.text, borderColor: theme.border, marginBottom: 16 }]}
                      />
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Pressable onPress={cancelEditingItem} style={({ pressed }) => [styles.cancelBtn, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
                          <Text style={{ color: theme.text }}>Cancel</Text>
                        </Pressable>
                        <Pressable onPress={saveItemEdit} style={({ pressed }) => [styles.saveBtn, { backgroundColor: GREEN, opacity: pressed ? 0.8 : 1 }]}>
                          <Text style={{ color: 'white', fontWeight: '700' }}>Save</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <Text style={[styles.detailTitle, { color: theme.text, flex: 1, marginRight: 12 }]} numberOfLines={2}>{displayItem.name}</Text>
                        <Pressable onPress={startEditingItem} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, flexShrink: 0 }]}>
                          <Text style={{ color: theme.green, fontSize: 16 }}>✏️ Edit</Text>
                        </Pressable>
                      </View>
                      
                      <Text style={[styles.detailPrice, { color: theme.green }]}>
                        {formatPrice(displayItem.price)}
                      </Text>
                    </View>
                  )}

                {/* Points section */}
                <View style={styles.detailPointsSection}>
                  <Text style={[styles.detailPointsLabel, { color: theme.text }]}>Current Points</Text>
                  {getWeeklyPoints(selectedItem) > 0 && (
                    <Text style={[styles.detailWeeklyPoints, { 
                      color: getTrendingStatus(selectedItem) === 'hot' ? '#FF6B35' : getTrendingStatus(selectedItem) === 'trending' ? theme.green : theme.subtext 
                    }]}>
                      {getWeeklyPoints(selectedItem)} points this week
                    </Text>
                  )}
                  <View style={styles.detailPointsRow}>
                    <Pressable
                      onPress={() => addPoint(selectedItem.id)}
                      disabled={remainingPoints <= 0}
                      style={({ pressed }) => [
                        styles.detailCircleBtn,
                        {
                          borderColor: theme.green,
                          opacity: pressed ? 0.8 : 1,
                          backgroundColor: remainingPoints > 0 ? 'transparent' : theme.border,
                        }
                      ]}
                    >
                      <Animated.Text style={[
                        styles.detailBtnText,
                        {
                          color: remainingPoints > 0 ? theme.green : theme.subtext,
                          transform: [{ scale: getUpvoteAnim(selectedItem.id) }]
                        }
                      ]}>
                        ↑
                      </Animated.Text>
                    </Pressable>

                    <Animated.Text style={[styles.detailPointsText, { color: theme.text, transform: [{ scale: pointAnim }] }]}>
                      {selectedItem.points}
                    </Animated.Text>

                    <Pressable
                      onPress={() => removePoint(selectedItem.id)}
                      disabled={selectedItem.points <= 0 || remainingPoints >= MAX_DAILY_POINTS}
                      style={({ pressed }) => [
                        styles.detailCircleBtn,
                        {
                          borderColor: theme.green,
                          opacity: pressed ? 0.8 : 1,
                          backgroundColor: (selectedItem.points > 0 && remainingPoints < MAX_DAILY_POINTS) ? 'transparent' : theme.border,
                        }
                      ]}
                    >
                      <Text style={[styles.detailBtnText, { color: (selectedItem.points > 0 && remainingPoints < MAX_DAILY_POINTS) ? theme.green : theme.subtext }]}>↓</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Purchase link */}
                {displayItem.link && (
                  <Pressable
                    onPress={() => openPurchaseLink(displayItem.link!)}
                    style={({ pressed }) => [
                      styles.purchaseLinkButton,
                      { backgroundColor: GREEN, opacity: pressed ? 0.8 : 1 }
                    ]}
                  >
                    <Text style={styles.purchaseLinkText}>🛒 Open Purchase Link</Text>
                  </Pressable>
                )}

                {/* Options section */}
                {selectedItem.options && selectedItem.options.length > 0 && (
                  <View style={styles.optionsSection}>
                    <Text style={[styles.optionsTitle, { color: theme.text }]}>Options</Text>
                    {selectedItem.options.map((option) => (
                      <View key={option.id} style={[styles.optionCard, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                        <View style={styles.optionHeader}>
                          <Image
                            source={{ uri: option.imageUrl || 'https://via.placeholder.com/60' }}
                            style={styles.optionImage}
                          />
                          <Text style={[styles.optionName, { color: theme.text }]} numberOfLines={2}>{option.name}</Text>
                        </View>
                        <View style={styles.optionFooter}>
                          <Text style={[styles.optionPrice, { color: theme.green }]}>{formatPrice(option.price)}</Text>
                          <View style={styles.optionActions}>
                            {selectedItem.selectedOptionId === option.id ? (
                              <View style={[styles.selectedBadge, { backgroundColor: GREEN }]}>
                                <Text style={styles.selectedText}>✓ Selected</Text>
                              </View>
                            ) : (
                              <Pressable
                                onPress={() => selectOptionAsMain(selectedItem.id, option.id)}
                                style={({ pressed }) => [
                                  styles.selectButton,
                                  { borderColor: theme.green, opacity: pressed ? 0.7 : 1 }
                                ]}
                              >
                                <Text style={[styles.selectButtonText, { color: theme.green }]}>Select</Text>
                              </Pressable>
                            )}
                            <Pressable
                              onPress={() => deleteOption(selectedItem.id, option.id)}
                              style={({ pressed }) => [
                                styles.deleteOptionButton,
                                { opacity: pressed ? 0.7 : 1 }
                              ]}
                            >
                              <Text style={styles.deleteOptionText}>🗑️</Text>
                            </Pressable>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Add Option button */}
                <Pressable
                  onPress={openAddOption}
                  style={({ pressed }) => [
                    styles.addOptionButton,
                    { borderColor: theme.green, opacity: pressed ? 0.7 : 1 }
                  ]}
                >
                  <Text style={[styles.addOptionText, { color: theme.green }]}>+ Add Option</Text>
                </Pressable>

                {/* Date added */}
                <Text style={[styles.detailDate, { color: theme.subtext }]}>
                  Added: {new Date(selectedItem.dateAdded).toLocaleDateString()}
                </Text>

                {selectedItem.isPurchased && selectedItem.datePurchased && (
                  <Text style={[styles.detailDate, { color: theme.subtext }]}>
                    Purchased: {new Date(selectedItem.datePurchased).toLocaleDateString()}
                  </Text>
                )}

                {/* Action buttons */}
                <View style={styles.detailActions}>
                  <Pressable
                    onPress={() => {
                      togglePurchased(selectedItem.id);
                      closeItemDetail();
                    }}
                    style={({ pressed }) => [
                      styles.detailActionButton,
                      { borderColor: theme.green, opacity: pressed ? 0.7 : 1 }
                    ]}
                  >
                    <Text style={[styles.detailActionText, { color: theme.green }]}>
                      {selectedItem.isPurchased ? 'Unmark Purchased' : 'Mark as Purchased'}
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      confirmDelete(selectedItem.id);
                      closeItemDetail();
                    }}
                    style={({ pressed }) => [
                      styles.detailActionButton,
                      { borderColor: '#EF4444', opacity: pressed ? 0.7 : 1 }
                    ]}
                  >
                    <Text style={[styles.detailActionText, { color: '#EF4444' }]}>
                      Delete Item
                    </Text>
                  </Pressable>
                </View>
              </View>
            </ScrollView>
            );
          })()}
        </SafeAreaView>
      </Modal>

      {/* Add Option Modal */}
      <Modal 
        visible={isAddOptionOpen} 
        animationType="slide" 
        onRequestClose={() => setIsAddOptionOpen(false)}
        presentationStyle="fullScreen"
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            {/* Header with back button */}
            <View style={[styles.detailHeader, { borderBottomColor: theme.border }]}>
              <Pressable onPress={() => setIsAddOptionOpen(false)} style={styles.backButton}>
                <Text style={[styles.backButtonText, { color: theme.text }]}>← Back</Text>
              </Pressable>
              <Text style={[styles.detailHeaderTitle, { color: theme.text }]}>Add Option</Text>
              <View style={{ width: 60 }} />
            </View>
            
            <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
              <Text style={[styles.inputLabel, { color: theme.text }]}>Purchase Link (optional)</Text>
              <View style={styles.inputWithButton}>
                <TextInput
                  value={optionLink}
                  onChangeText={handleOptionUrlChange}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="https://..."
                  placeholderTextColor={theme.subtext}
                  style={[styles.input, { color: theme.text, borderColor: theme.border, flex: 1, marginRight: 8 }]}
                />
                <Pressable onPress={handleOptionPaste} style={[styles.pasteButton, { borderColor: theme.border }]}>
                  <Text style={[styles.pasteButtonText, { color: theme.text }]}>Paste</Text>
                </Pressable>
              </View>

              {isOptionScraping && (
                <View style={styles.scrapingIndicator}>
                  <Text style={[styles.scrapingText, { color: theme.subtext }]}>🔍 Scraping product data...</Text>
                </View>
              )}

              {optionScrapedData && (optionScrapedData.name || optionScrapedData.price !== null || optionScrapedData.imageUrl) && (
                <View style={[styles.scrapedPreview, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <Text style={[styles.scrapedPreviewTitle, { color: theme.text }]}>✨ Scraped Data</Text>
                  {optionScrapedData.imageUrl && (
                    <Image source={{ uri: optionScrapedData.imageUrl }} style={styles.scrapedImage} resizeMode="contain" />
                  )}
                  <Text style={[styles.scrapedPreviewText, { color: theme.text }]}>
                    {optionScrapedData.name && `Name: ${optionScrapedData.name}`}
                    {optionScrapedData.price !== null && `\nPrice: ${formatPrice(optionScrapedData.price)}`}
                    {optionScrapedData.imageUrl && '\nImage: Found'}
                  </Text>
                </View>
              )}

              <Text style={[styles.inputLabel, { color: theme.text }]}>Option Name</Text>
              <TextInput
                value={optionName}
                onChangeText={setOptionName}
                placeholder="e.g., Cervelo P5"
                placeholderTextColor={theme.subtext}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />

              <Text style={[styles.inputLabel, { color: theme.text }]}>Price (optional)</Text>
              <TextInput
                value={optionPrice}
                onChangeText={setOptionPrice}
                keyboardType="decimal-pad"
                placeholder="50 (optional)"
                placeholderTextColor={theme.subtext}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />

              <Text style={[styles.inputLabel, { color: theme.text }]}>Image URL</Text>
              <TextInput
                value={optionImageUrl}
                onChangeText={setOptionImageUrl}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="https:// or file path"
                placeholderTextColor={theme.subtext}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />

              <Pressable onPress={pickOptionImage} style={({ pressed }) => [styles.pickBtn, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ color: theme.text }}>Pick from Photos</Text>
              </Pressable>

              {optionImageUrl ? (
                <Image source={{ uri: optionImageUrl }} style={{ width: '100%', height: 180, borderRadius: 12, marginTop: 12 }} resizeMode="contain" />
              ) : null}

              <View style={{ height: 16 }} />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Pressable onPress={() => setIsAddOptionOpen(false)} style={({ pressed }) => [styles.cancelBtn, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
                  <Text style={{ color: theme.text }}>Cancel</Text>
                </Pressable>
                <Pressable 
                  onPress={saveNewOption} 
                  disabled={isSaving}
                  style={({ pressed }) => [styles.saveBtn, { backgroundColor: GREEN, opacity: pressed ? 0.8 : 1 }]}
                >
                  <Text style={{ color: 'white', fontWeight: '700' }}>
                    {isSaving ? 'Scraping...' : 'Save Option'}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: 'white',
    fontSize: 22,
    fontWeight: '800',
  },
  statusBar: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  statusBarText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  fireEmoji: {
    fontSize: 20,
    marginLeft: 6,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 0,
    marginLeft: 6,
  },
  headerBtnText: {
    color: 'white',
    fontWeight: '600',
  },
  addBtn: {
    marginLeft: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: {
    color: GREEN,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 20,
  },
  pointsDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 8,
  },
  pointsEmoji: {
    fontSize: 12,
    marginRight: 4,
  },
  sortButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: 'transparent',
  },
  sortButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  card: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    marginHorizontal: 2,
  },
  purchasedBadge: {
    position: 'absolute',
    right: 12,
    top: 12,
    backgroundColor: '#E6F4EC',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    zIndex: 1,
  },
  purchasedBadgeText: {
    color: GREEN,
    fontWeight: '700',
    fontSize: 12,
  },
  optionsBadge: {
    position: 'absolute',
    left: 12,
    top: 12,
    backgroundColor: '#3B82F6',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 1,
  },
  optionsBadgeText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 11,
  },
  trendingBadge: {
    position: 'absolute',
    right: 12,
    top: 12,
    backgroundColor: '#FF6B35',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    zIndex: 1,
  },
  trendingBadgeText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 11,
  },
  gradientOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
  },
  row: {
    flexDirection: 'row',
  },
  image: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    flexShrink: 1,
  },
  pointsRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  circleBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontSize: 22,
    fontWeight: '700',
  },
  pointsText: {
    fontSize: 24,
    fontWeight: '800',
  },
  actionsRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  toggleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 12,
  },
  inputLabel: {
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  pickBtn: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 120,
    alignItems: 'center',
  },
  saveBtn: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minWidth: 120,
    alignItems: 'center',
  },
  // Detail Modal Styles
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  detailHeaderTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  detailImageContainer: {
    position: 'relative',
    marginBottom: 16,
    height: 300,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  detailImage: {
    width: '100%',
    height: '100%',
    backgroundColor: '#FFFFFF',
  },
  changeImageButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  changeImageText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  detailPurchasedBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: '#E6F4EC',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  detailPurchasedText: {
    color: GREEN,
    fontWeight: '700',
    fontSize: 12,
  },
  detailContent: {
    margin: 16,
    padding: 20,
    borderRadius: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  detailTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 8,
  },
  detailPrice: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 20,
  },
  detailPointsSection: {
    marginBottom: 20,
  },
  detailPointsLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
  },
  detailWeeklyPoints: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  detailPointsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  detailCircleBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  detailBtnText: {
    fontSize: 24,
    fontWeight: '700',
  },
  detailPointsText: {
    fontSize: 32,
    fontWeight: '800',
  },
  purchaseLinkButton: {
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  purchaseLinkText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '700',
  },
  detailDate: {
    fontSize: 14,
    marginBottom: 8,
  },
  detailActions: {
    marginTop: 20,
    gap: 12,
  },
  detailActionButton: {
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  detailActionText: {
    fontSize: 16,
    fontWeight: '700',
  },
  // Options Section Styles
  optionsSection: {
    marginTop: 20,
  },
  optionsTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  optionCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  optionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  optionImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: '#D1D5DB',
    marginRight: 12,
  },
  optionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionInfo: {
    flex: 1,
    marginLeft: 12,
  },
  optionName: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
    lineHeight: 20,
    maxHeight: 40,
  },
  optionPrice: {
    fontSize: 14,
    fontWeight: '600',
  },
  optionActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  selectedBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  selectedText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '700',
  },
  selectButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  selectButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  deleteOptionButton: {
    padding: 4,
  },
  deleteOptionText: {
    fontSize: 16,
  },
  addOptionButton: {
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginTop: 16,
  },
  addOptionText: {
    fontSize: 16,
    fontWeight: '700',
  },
  // Empty State Styles
  emptyStateContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyStateEmoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyStateTitle: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyStateSubtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 16,
  },
  emptyStateAction: {
    fontSize: 16,
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 8,
  },
  emptyStateArrow: {
    marginTop: 8,
  },
  emptyStateArrowText: {
    fontSize: 32,
  },
  // Enhanced Add Item Styles
  inputWithButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pasteButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 60,
    alignItems: 'center',
  },
  pasteButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  scrapingIndicator: {
    marginTop: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  scrapingText: {
    fontSize: 14,
    fontStyle: 'italic',
  },
  scrapedPreview: {
    marginTop: 12,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  scrapedPreviewTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  scrapedImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  scrapedPreviewText: {
    fontSize: 14,
    lineHeight: 18,
  },
});



