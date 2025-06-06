import React from 'react';
import { Page, View, Document, StyleSheet, Image } from '@react-pdf/renderer';
import { Style } from '@react-pdf/types';
import { VisualizationData } from '../types';

type ExtendedStyle = Style & {
  breakBefore?: 'page' | 'auto';
  breakInside?: 'avoid';
};

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    paddingBottom: 50,
    position: 'relative',
  },
  pageTOC: {
    padding: 40,
    paddingTop: 60,
    fontFamily: 'Helvetica',
    paddingBottom: 50,
    position: 'relative',
  },
  dashboardTitle: {
    marginBottom: 15,
    borderBottom: 2,
    borderColor: '#c0c0c0',
    paddingBottom: 10,
    alignItems: 'center',
  },
  dashboardTitleImage: {
    width: '70%',
    maxHeight: 110,
    objectFit: 'contain',
  },
  titleDivider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    width: '100%',
    marginTop: 2,
    marginBottom: 4,
    marginLeft: -20,
    alignSelf: 'flex-start',
  },
  header: {
    marginBottom: 8,
    borderBottom: 0,
    borderColor: '#eeeeee',
    paddingBottom: 5,
    alignItems: 'center',
  },
  headerImageContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 5,
  },
  headerImage: {
    width: '400',
    maxHeight: 45,
    objectFit: 'contain',
  },
  visualization: {
    marginVertical: 6,
    padding: 8,
    border: 2,
    borderColor: '#e0e0e0',
    borderRadius: 4,
    position: 'relative',
    pageBreakInside: 'avoid',
    boxShadow: 'inset 0 0 0 1px #f8f8f8',
  },
  image: {
    width: '100%',
    maxHeight: 260,
    objectFit: 'contain',
    marginVertical: 10,
    alignSelf: 'center',
    border: 0,
    borderColor: '#f0f0f0',
    borderRadius: 2,
    padding: 4,
  },
  vizTitleContainer: {
    marginBottom: 2,
    width: '80%',
    alignSelf: 'flex-start',
    position: 'relative',
    paddingBottom: 2,
    marginLeft: 20, 
  },
  vizTitleImage: {
    width: '80%',
    objectFit: 'contain',
    marginBottom: 2,
    textAlign: 'left',
    zIndex: 1,
  },
  footerImage: {
    position: 'absolute',
    bottom: 15,
    left: 0,
    right: 0,
    width: '100%',
    height: 30,
    alignSelf: 'center',
    marginLeft: 20,
  },
  pageContent: {
    flexDirection: 'column',
    gap: 12,
  },
  pairContainer: {
    marginBottom: 15,
    pageBreakInside: 'avoid',
  },
  headerLogoContainer: {
    position: 'absolute',
    top: 20,
    right: 10,
    width: 120,
    height: 40,
    zIndex: 1000,
  },
  pageContentWrapper: {
    position: 'relative',
    zIndex: 1,
  },
  headerLogoImage: {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
  },
});

export const PdfDocument: React.FC<{
  allowTableOfContents: boolean;
  visualizations: VisualizationData[];
  logo?: string;
}> = ({ allowTableOfContents, visualizations, logo }) => {
  const tocVisualization = visualizations.find(viz => viz.type === 'TableOfContents');
  const dashboardTitle = visualizations.find(viz => viz.type === 'DashboardTitle');
  const headers = visualizations.filter(viz => viz.type === 'Header');
  const pageFooters = visualizations.filter(viz => viz.type === 'PageFooter');
  const pairs: VisualizationData[][] = [];
  let currentPair: VisualizationData[] = [];
  
  visualizations
  .filter(viz => ['visualizationTitle', 'Visualization'].includes(viz.type))
  .forEach(viz => {
    if (viz.type === 'visualizationTitle') {
      if (currentPair.length > 0) pairs.push(currentPair);
      currentPair = [viz];
    } else {
      if (currentPair.length === 0) {
        currentPair.push({
          id: 'auto-title-' + viz.id,
          type: 'visualizationTitle',
          title: 'Untitled Visualization',
          data: ''
        });
      }
      currentPair.push(viz);
      pairs.push(currentPair);
      currentPair = [];
    }
  });

  const pages: VisualizationData[][][] = [];
  if (pairs.length > 0) {
    pages.push([pairs[0]]);
    const remainingPairs = pairs.slice(1);
    const itemsPerPage = 2;
    for (let i = 0; i < remainingPairs.length; i += itemsPerPage) {
      pages.push(remainingPairs.slice(i, i + itemsPerPage));
    }
  }

  return (
    <Document>
      {/* TOC Page */}
      {tocVisualization && allowTableOfContents && (
        <Page size="A4" style={styles.pageTOC}>
          {logo && (
            <View style={styles.headerLogoContainer}>
              <Image src={logo} style={styles.headerLogoImage} />
            </View>
          )}
          <Image src={tocVisualization.data} style={{ width: '100%', height: '100%' }} />
          {pageFooters[0] && (
            <Image src={pageFooters[0].data} style={styles.footerImage} fixed />
          )}
        </Page>
      )}

      {/* Content Pages */}
      {pages.length > 0 && pages.map((pagePairs, pageIndex) => {
        const pageNumber = pageIndex + 2;
        
        return (
          <Page key={`page-${pageIndex}`} size="A4" style={styles.page}>
            {/* Logo */}
            {logo && (
              <View style={styles.headerLogoContainer}>
                <Image src={logo} style={styles.headerLogoImage} />
              </View>
            )}

            {/* Header content */}
            {pageIndex === 0 && (
              <>
                {dashboardTitle && (
                  <View style={styles.dashboardTitle}>
                    <Image src={dashboardTitle.data} style={styles.dashboardTitleImage} />
                  </View>
                )}
                {headers.length > 0 && (
                  <View style={styles.header}>
                    {headers.map((viz) => (
                      <View key={viz.id} style={styles.headerImageContainer}>
                        <Image src={viz.data} style={styles.headerImage} />
                      </View>
                    ))}
                  </View>
                )}
              </>
            )}

            {/* Page Content */}
            <View style={styles.pageContent}>
              {pagePairs.flat().map((viz, pairIndex) => (
                <View 
                  key={viz.id} 
                  style={[
                    styles.pairContainer as ExtendedStyle,
                    pairIndex % 2 === 0 ? { breakBefore: 'page' } : {}
                  ] as ExtendedStyle[]}
                >
                  {viz.type === 'visualizationTitle' && (
                    <View style={styles.vizTitleContainer}>
                      <Image src={viz.data} style={styles.vizTitleImage} />
                      <View style={styles.titleDivider} />
                    </View>
                  )}
                  {viz.type === 'Visualization' && (
                    <View style={styles.visualization}>
                      <Image src={viz.data} style={styles.image} />
                    </View>
                  )}
                </View>
              ))}
            </View>

            {/* Footer */}
            {pageFooters[pageNumber + 1] && (
              <Image
                src={pageFooters[pageNumber + 1].data}
                style={styles.footerImage}
                fixed
              />
            )}
          </Page>
        );
      })}
    </Document>
  );
};