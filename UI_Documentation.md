# AI Active Calls Dashboard - UI Documentation

## Overview
The AI Active Calls Dashboard is a real-time monitoring interface for call handling workflows. It provides comprehensive filtering, search, and management capabilities for monitoring pending calls across different workflow states.

## Key Features

### 🔄 Real-Time Updates
- **WebSocket Integration**: Automatic updates when call data changes
- **Live Status Monitoring**: Real-time workflow state changes
- **Background Synchronization**: Maintains data consistency without manual refresh

### 🎛️ Advanced Filtering System

#### Multi-Select Dropdown Filters
- **Status Filter**: Filter by workflow states (Pending, New, Ready to Call, Calling, Classifying, Completed, Failed, Retry Pending)
- **Date Range Filter**: Filter by appointment dates (Today, Tomorrow, Yesterday, Last 7 Days, Last 30 Days, Older than 30 Days)
- **Task Type Filter**: Filter by task categories (Records Request, Schedule, Kit Confirmation)

#### Filter Features
- **Multi-selection**: Choose multiple options within each filter category
- **Smart Display**: Shows "All" when no specific filters selected, or count when multiple selected
- **Custom Checkboxes**: Soft gray unchecked state, washed-out blue checked state
- **Persistent Storage**: Automatically saves and restores filter selections

#### Named Filter Presets
- **Save Current Filters**: Create named shortcuts for commonly used filter combinations
- **Quick Access Buttons**: One-click application of saved presets
- **Preset Management**: Delete unwanted presets with confirmation
- **Visual Feedback**: Active state highlighting and toast notifications
- **Examples**: "Today's Failed Calls", "Weekly Review", "Quick Status Check"

### 🔍 Search Functionality
- **Real-Time Search**: Instant filtering as you type
- **Comprehensive Coverage**: Searches across all visible columns (employee, client, clinic, phone, task, status, dates)
- **Clear Button**: Quick search reset with visual feedback
- **Keyboard Support**: Enter key and focus management
- **Case-Insensitive**: Smart matching regardless of case

### 📊 Table Features

#### Sortable Columns
- **Click Headers**: Sort by any column (employee, appointment, task, status, etc.)
- **Visual Indicators**: Arrow icons show current sort direction
- **Multi-Level Sorting**: Maintains secondary sorting for tied values

#### Resizable Columns
- **Drag Handles**: Adjust column widths to preference
- **Frozen First Column**: Employee name remains visible during horizontal scroll
- **Persistent Sizing**: Maintains column widths across sessions

#### Responsive Design
- **Compact Layout**: Optimized for information density
- **Horizontal Scroll**: Wide tables remain accessible on smaller screens
- **Mobile Friendly**: Touch-optimized interactions

### 🎨 Visual Design

#### Color Scheme
- **Primary Green**: #008d6f (buttons, accents)
- **Dark Header**: #2d3748 (top navigation)
- **Clean Background**: White with subtle gradients
- **Status Colors**: Color-coded workflow states

#### Typography
- **System Fonts**: -apple-system, BlinkMacSystemFont, 'Segoe UI'
- **Hierarchy**: Clear font weights and sizes for information hierarchy
- **Readability**: Optimized contrast ratios

#### Interactive Elements
- **Hover Effects**: Subtle feedback on all interactive elements
- **Smooth Transitions**: 0.2s ease animations
- **Loading States**: Clear feedback during data operations

### 🔐 Authentication & Security
- **Multi-Factor Authentication**: AAL2 requirement for dashboard access
- **Session Management**: Automatic redirect for unauthenticated users
- **Secure Storage**: All data stored securely with proper authentication

### 📱 Responsive Layout
- **Desktop First**: Optimized for desktop monitoring workflows
- **Tablet Support**: Functional on tablet devices
- **Mobile Accessible**: Basic functionality maintained on mobile

## File Structure

### HTML (`/public/dashboard.html`)
- **Modal Dialogs**: Save filter preset modal
- **Filter Controls**: Dropdown filter menus
- **Search Interface**: Search input with clear button
- **Data Table**: Sortable, resizable columns with real-time data

### CSS (`/public/styles/monitor.css`)
- **Component Styling**: Modular CSS for all UI components
- **Custom Checkboxes**: Browser-default override styling
- **Modal System**: Professional dialog styling
- **Responsive Breakpoints**: Mobile-first responsive design

### JavaScript (`/public/scripts/dashboard.js`)
- **Real-Time Engine**: WebSocket subscription management
- **Filter Logic**: Multi-select dropdown and preset management
- **Search Engine**: Real-time text filtering
- **Table Management**: Sorting, resizing, and data rendering
- **Local Storage**: Persistent user preferences

## User Workflows

### Daily Monitoring Workflow
1. **Login**: Secure authentication with MFA
2. **Apply Filters**: Use presets or custom filters for relevant data
3. **Real-Time Monitoring**: Watch for status changes and new calls
4. **Search & Investigate**: Use search to find specific calls
5. **Take Action**: Click through to monitor or manage specific calls

### Filter Management Workflow
1. **Set Filters**: Configure desired filter combination
2. **Save Preset**: Click "Save Filter" and name the combination
3. **Quick Access**: Use preset buttons for instant filter application
4. **Manage Presets**: Delete outdated presets as needed

### Search Workflow
1. **Type Query**: Enter search terms in real-time search box
2. **Review Results**: See filtered results instantly
3. **Clear Search**: Use clear button or empty field to reset
4. **Combine Filters**: Use search with existing filters for precise results

## Performance Considerations

### Optimization Features
- **Virtual Scrolling**: Efficient handling of large datasets
- **Debounced Search**: Optimized search performance
- **Lazy Loading**: Progressive data loading
- **Memory Management**: Efficient DOM manipulation

### Real-Time Performance
- **WebSocket Efficiency**: Minimal bandwidth usage
- **Selective Updates**: Only refreshes changed data
- **Background Processing**: Non-blocking UI operations

## Browser Support
- **Chrome**: Full support (recommended)
- **Firefox**: Full support
- **Safari**: Full support
- **Edge**: Full support
- **Mobile Browsers**: Basic functionality

## Accessibility Features
- **Keyboard Navigation**: Full keyboard accessibility
- **Screen Reader Support**: ARIA labels and semantic HTML
- **High Contrast**: Support for high contrast modes
- **Focus Management**: Clear focus indicators

## Future Enhancements
- **Export Functionality**: Download filtered data
- **Advanced Analytics**: Call statistics and trends
- **Notification System**: Alerts for critical events
- **Bulk Actions**: Multi-select operations
- **Column Customization**: User-defined column visibility

---

*Last Updated: January 2025*  
*Dashboard Version: v7*