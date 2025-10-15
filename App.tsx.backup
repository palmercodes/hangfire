import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, FlatList, Pressable, Image, StyleSheet, useColorScheme, Alert, Animated, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView, Switch } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';

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
};

type PersistedState = {
  items: WishlistItem[];
  remainingPoints: number;
  lastResetDate: string; // yyyy-mm-dd
};

const MAX_DAILY_POINTS = 3;
const STORAGE_KEY = 'wishlist_app_state_v1';
const GREEN = '#4A7C59';

function getTodayKey(): string {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function seedItems(): WishlistItem[] {
  const nowIso = new Date().toISOString();
  return [
    {
      id: '1',
      name: 'Noise-Cancelling Headphones',
      price: 299.99,
      link: '',
      imageUrl: 'https://images.unsplash.com/photo-1518443204071-6f9c8f6e0b83?w=640',
      points: 1,
      dateAdded: nowIso,
      isPurchased: false,
    },
    {
      id: '2',
      name: 'Espresso Machine',
      price: 549,
      link: '',
      imageUrl: 'https://images.unsplash.com/photo-1504754524776-8f4f37790ca0?w=640',
      points: 0,
      dateAdded: nowIso,
      isPurchased: false,
    },
    {
      id: '3',
      name: 'Running Shoes',
      price: 120,
      link: '',
      imageUrl: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=640',
      points: 2,
      dateAdded: nowIso,
      isPurchased: false,
    },
  ];
}

function MainApp() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<WishlistItem[]>([]);
  const [remainingPoints, setRemainingPoints] = useState<number>(MAX_DAILY_POINTS);
  const [lastResetDate, setLastResetDate] = useState<string>(getTodayKey());
  const pointAnim = useRef(new Animated.Value(1)).current;
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formLink, setFormLink] = useState('');
  const [formImageUrl, setFormImageUrl] = useState('');
  const [hidePurchased, setHidePurchased] = useState(false);
  const [sortMode, setSortMode] = useState<'points' | 'date' | 'price'>('points');

  const sortedItems = useMemo(() => {
    const filtered = hidePurchased ? items.filter(i => !i.isPurchased) : items;
    const arr = [...filtered];
    if (sortMode === 'points') arr.sort((a, b) => b.points - a.points);
    if (sortMode === 'date') arr.sort((a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime());
    if (sortMode === 'price') arr.sort((a, b) => b.price - a.price);
    return arr;
  }, [items, hidePurchased, sortMode]);

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
    };
  }, [isDark]);

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

  const addPoint = useCallback((id: string) => {
    setItems(prev => {
      if (remainingPoints <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return prev;
      }
      const next = prev.map(it => (it.id === id ? { ...it, points: it.points + 1 } : it));
      return next;
    });
    setRemainingPoints(p => (p > 0 ? p - 1 : p));
    animatePoints();
    if (remainingPoints > 0) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [remainingPoints, animatePoints]);

  const removePoint = useCallback((id: string) => {
    setItems(prev => {
      const target = prev.find(it => it.id === id);
      if (!target || target.points <= 0) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return prev;
      }
      const next = prev.map(it => (it.id === id ? { ...it, points: Math.max(0, it.points - 1) } : it));
      return next;
    });
    setRemainingPoints(p => (p < MAX_DAILY_POINTS ? p + 1 : p));
    animatePoints();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [animatePoints]);

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

  const openAdd = useCallback(() => {
    setFormName('');
    setFormPrice('');
    setFormLink('');
    setFormImageUrl('');
    setIsAddOpen(true);
  }, []);

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

  const saveNewItem = useCallback(() => {
    const name = formName.trim();
    const price = parseFloat(formPrice);
    if (!name) {
      Alert.alert('Name required', 'Please enter an item name.');
      return;
    }
    if (isNaN(price) || price < 0) {
      Alert.alert('Invalid price', 'Enter a valid non-negative price.');
      return;
    }
    const newItem: WishlistItem = {
      id: String(Date.now()),
      name,
      price,
      link: formLink.trim() || undefined,
      imageUrl: formImageUrl.trim() || undefined,
      points: 0,
      dateAdded: new Date().toISOString(),
      isPurchased: false,
    };
    setItems(prev => [newItem, ...prev]);
    setIsAddOpen(false);
  }, [formName, formPrice, formLink, formImageUrl]);

  const renderItem = useCallback(({ item }: { item: WishlistItem }) => {
    return (
      <View style={[
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
      ]}> 
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
        <View style={styles.row}>
          <Image
            source={{ uri: item.imageUrl || 'https://via.placeholder.com/96' }}
            style={[styles.image, item.isPurchased ? { opacity: 0.6 } : null]}
          />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <View style={[styles.row, { alignItems: 'center' }]}> 
              <Text
                style={[
                  styles.title,
                  {
                    color: item.isPurchased ? theme.subtext : theme.text,
                    textDecorationLine: item.isPurchased ? 'line-through' : 'none',
                  },
                ]}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {item.isPurchased ? (
                <Text style={{ marginLeft: 8, color: theme.green }}>✓</Text>
              ) : null}
            </View>
            {item.isPurchased ? (
              <Text style={{ color: theme.green, marginTop: 2 }}>🛒 Purchased {item.datePurchased ? new Date(item.datePurchased).toLocaleDateString() : ''}</Text>
            ) : null}
            <Text style={{ color: theme.subtext, marginTop: 2 }}>📅 {new Date(item.dateAdded).toLocaleDateString()}</Text>
            <Text style={{ color: theme.subtext, marginTop: 2, textAlign: 'right' }}>
              ${item.price.toFixed(2)}
            </Text>
          </View>
        </View>

        <View style={[styles.pointsRow]}> 
          <Pressable
            onPress={() => removePoint(item.id)}
            style={({ pressed }) => [
              styles.circleBtn, 
              { 
                borderColor: theme.green, 
                opacity: pressed ? 0.8 : 1,
                transform: [{ scale: pressed ? 0.95 : 1 }],
                shadowColor: theme.shadow,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.15,
                shadowRadius: 4,
                elevation: 2,
              }
            ]}
          >
            <Text style={[styles.btnText, { color: theme.green }]}>−</Text>
          </Pressable>

          <Animated.Text style={[styles.pointsText, { color: theme.text, transform: [{ scale: pointAnim }] }]}>
            {item.points}
          </Animated.Text>

          <Pressable
            onPress={() => addPoint(item.id)}
            disabled={remainingPoints <= 0}
            style={({ pressed }) => [
              styles.circleBtn,
              { 
                borderColor: theme.green, 
                opacity: pressed ? 0.8 : 1, 
                backgroundColor: remainingPoints > 0 ? 'transparent' : theme.border,
                transform: [{ scale: pressed ? 0.95 : 1 }],
                shadowColor: theme.shadow,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.15,
                shadowRadius: 4,
                elevation: 2,
              },
            ]}
          >
            <Text style={[styles.btnText, { color: theme.green }]}>+</Text>
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
      </View>
    );
  }, [addPoint, removePoint, confirmDelete, togglePurchased, theme, remainingPoints, pointAnim]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      
      <LinearGradient
        colors={isDark ? ['#0B0B0B', '#1A1A1A'] : ['#F8FAFC', '#F1F5F9']}
        style={StyleSheet.absoluteFillObject}
      />

      <LinearGradient
        colors={[GREEN, '#3A6B47']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.header}
      > 
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Hangfire</Text>
          <Text style={styles.fireEmoji}>🔥</Text>
        </View>
        <View style={styles.headerActions}> 
          <Pressable style={styles.headerBtn} onPress={() => {
            setSortMode(m => (m === 'points' ? 'date' : m === 'date' ? 'price' : 'points'));
          }}>
            <Text style={styles.headerBtnText}>{sortMode === 'points' ? 'Sort: Points' : sortMode === 'date' ? 'Sort: Date' : 'Sort: Price'}</Text>
          </Pressable>
          <Pressable style={styles.addBtn} onPress={openAdd}>
            <Text style={styles.addBtnText}>＋</Text>
          </Pressable>
        </View>
      </LinearGradient>

      <FlatList
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        data={sortedItems}
        keyExtractor={(it) => it.id}
        renderItem={renderItem}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
      />

      <View style={[styles.footer, { borderTopColor: theme.border, backgroundColor: theme.bg, paddingBottom: Math.max(insets.bottom, 12) }]}> 
        <Text style={{ color: theme.text }}>Daily Points: {remainingPoints}/{MAX_DAILY_POINTS}</Text>
        <View style={styles.toggleContainer}>
          <Text style={[styles.toggleLabel, { color: theme.text }]}>
            {hidePurchased ? 'Hide Purchased' : 'Include Purchased'}
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
              <Text style={[styles.inputLabel, { color: theme.text }]}>Name</Text>
              <TextInput
                value={formName}
                onChangeText={setFormName}
                placeholder="Item name"
                placeholderTextColor={theme.subtext}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />

              <Text style={[styles.inputLabel, { color: theme.text }]}>Price</Text>
              <TextInput
                value={formPrice}
                onChangeText={setFormPrice}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={theme.subtext}
                style={[styles.input, { color: theme.text, borderColor: theme.border }]}
              />

              <Text style={[styles.inputLabel, { color: theme.text }]}>Purchase Link</Text>
              <TextInput
                value={formLink}
                onChangeText={setFormLink}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="https://..."
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
                <Image source={{ uri: formImageUrl }} style={{ width: '100%', height: 180, borderRadius: 12, marginTop: 12 }} />
              ) : null}

              <View style={{ height: 16 }} />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Pressable onPress={() => setIsAddOpen(false)} style={({ pressed }) => [styles.cancelBtn, { borderColor: theme.border, opacity: pressed ? 0.7 : 1 }]}>
                  <Text style={{ color: theme.text }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={saveNewItem} style={({ pressed }) => [styles.saveBtn, { backgroundColor: GREEN, opacity: pressed ? 0.8 : 1 }]}>
                  <Text style={{ color: 'white', fontWeight: '700' }}>Save</Text>
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
    backgroundColor: '#D1D5DB',
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
});



