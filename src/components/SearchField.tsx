import { Input, Text, XStack } from "tamagui";

interface SearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}

export default function SearchField({
  value,
  onChangeText,
  placeholder,
}: SearchFieldProps) {
  return (
    <XStack
      ai="center"
      bg="$backgroundElement"
      borderRadius={999}
      px="$3"
      borderWidth={1}
      borderColor="$borderColor"
      h={50}
      gap="$2"
    >
      <Text color="$color" opacity={0.55} fos="$5">
        ⌕
      </Text>
      <Input
        unstyled
        f={1}
        color="$color"
        placeholder={placeholder}
        placeholderTextColor="$color10"
        value={value}
        onChangeText={onChangeText}
        keyboardAppearance="dark"
        autoCapitalize="none"
        autoCorrect={false}
      />
    </XStack>
  );
}
