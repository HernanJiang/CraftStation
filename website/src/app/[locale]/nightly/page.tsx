import type { Metadata } from "next";

import { NightlyContent } from "@/app/nightly/nightly-content";
import type { Locale } from "@/lib/i18n/config";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { getLocaleMessages, translate } from "@/lib/i18n/messages";
import { getLatestNightlyRelease } from "@/lib/releases";
import { createPageMetadata } from "@/lib/seo";

type LocaleParams = { params: Promise<{ locale: Locale }> };

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const { locale } = await params;
  return createPageMetadata({
    title: translate(locale, "nightly.title"),
    description: translate(locale, "nightly.metaDescription"),
    path: "/nightly",
    locale,
  });
}

export default async function LocaleNightlyPage({ params }: LocaleParams) {
  const { locale } = await params;
  const release = await getLatestNightlyRelease();
  return (
    <I18nProvider locale={locale} messages={getLocaleMessages(locale)}>
      <NightlyContent release={release} />
    </I18nProvider>
  );
}
