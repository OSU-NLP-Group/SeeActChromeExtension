interface BuildConfig {
    BUILD_TIMESTAMP: string;
    BUILD_VERSION: string;
}

declare const __BUILD_CONFIG: BuildConfig;

export const getBuildConfig = (): BuildConfig => {
    if (typeof __BUILD_CONFIG !== 'undefined') {
        return __BUILD_CONFIG;
    }
    throw new Error('Build configuration not available');
};