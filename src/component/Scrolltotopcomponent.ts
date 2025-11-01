import React, { useRef, useState } from 'react';
import {
    View,
    ScrollView,
    TouchableOpacity,
    Text,
    StyleSheet,
    Animated,
} from 'react-native';

interface ScrollToTopComponentProps {
    items?: number;
}

const ScrollToTopComponent: React.FC<ScrollToTopComponentProps> = ({
    items = 50,
}) => {
    const scrollRef = useRef<ScrollView>(null);
    const [isScrollButtonVisible, setIsScrollButtonVisible] = useState(false);
    const fadeAnim = useRef(new Animated.Value(0)).current;

    const handleScroll = (event: any) => {
        const offsetY = event.nativeEvent.contentOffset.y;
        const isVisible = offsetY > 300; // แสดงปุ่มเมื่อเลื่อนมากกว่า 300px

        if (isVisible && !isScrollButtonVisible) {
            setIsScrollButtonVisible(true);
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
            }).start();
        } else if (!isVisible && isScrollButtonVisible) {
            setIsScrollButtonVisible(false);
            Animated.timing(fadeAnim, {
                toValue: 0,
                duration: 300,
                useNativeDriver: true,
            }).start();
        }
    };

    const scrollToTop = () => {
        scrollRef.current?.scrollTo({
            x: 0,
            y: 0,
            animated: true,
        });
    };

    const scrollToBottom = () => {
        scrollRef.current?.scrollToEnd({
            animated: true,
        });
    };

    return (
        <View style= { styles.container } >
        <ScrollView
        style={ styles.scrollView }
    ref = { scrollRef }
    scrollEventThrottle = { 16}
    onScroll = { handleScroll }
        >
        <View style={ styles.content }>
        {
            Array.from({ length: items }).map((_, i) => (
                <Text key= { i } style = { styles.itemText } >
                Item { i + 1}
            </Text>
          ))}
</View>
    </ScrollView>

{/* Scroll to Top Button */ }
{
    isScrollButtonVisible && (
        <Animated.View
          style={
        [
            styles.buttonWrapper,
            styles.scrollToTopButton,
            { opacity: fadeAnim },
        ]
    }
        >
        <TouchableOpacity
            style={ styles.button }
    onPress = { scrollToTop }
    activeOpacity = { 0.7}
        >
        <Text style={ styles.buttonText }>↑ Top </Text>
            </TouchableOpacity>
            </Animated.View>
      )
}

{/* Scroll to Bottom Button */ }
{
    isScrollButtonVisible && (
        <Animated.View
          style={
        [
            styles.buttonWrapper,
            styles.scrollToBottomButton,
            { opacity: fadeAnim },
        ]
    }
        >
        <TouchableOpacity
            style={ styles.button }
    onPress = { scrollToBottom }
    activeOpacity = { 0.7}
        >
        <Text style={ styles.buttonText }>↓ Bottom </Text>
            </TouchableOpacity>
            </Animated.View>
      )
}
</View>
  );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    content: {
        padding: 10,
        paddingBottom: 32,
    },
    itemText: {
        fontSize: 20,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#ccc',
    },
    buttonWrapper: {
        position: 'absolute',
        justifyContent: 'center',
        alignItems: 'center',
    },
    scrollToTopButton: {
        bottom: 100,
        right: 20,
    },
    scrollToBottomButton: {
        bottom: 20,
        right: 20,
    },
    button: {
        backgroundColor: '#2196F3',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 30,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    buttonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
});

export default ScrollToTopComponent;
