#!/bin/bash

# Script to run comprehensive workflow tests
# Usage: ./scripts/run-workflow-tests.sh [test-type]
# test-type: unit, integration, performance, all (default: all)

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get test type from argument or default to 'all'
TEST_TYPE=${1:-all}

print_status "Running workflow tests for: $TEST_TYPE"

# Ensure we're in the project root
cd "$(dirname "$0")/.."

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    print_warning "node_modules not found. Installing dependencies..."
    npm install
fi

# Function to run specific test suite
run_test_suite() {
    local suite_name=$1
    local test_pattern=$2
    local timeout=${3:-30000}
    
    print_status "Running $suite_name tests..."
    
    if npm test -- --selectProjects="$suite_name" --testTimeout="$timeout"; then
        print_success "$suite_name tests passed"
        return 0
    else
        print_error "$suite_name tests failed"
        return 1
    fi
}

# Function to run all tests
run_all_tests() {
    local failed_suites=()
    
    print_status "Running all workflow test suites..."
    
    # Run unit tests
    if ! run_test_suite "unit" "unit" 30000; then
        failed_suites+=("unit")
    fi
    
    # Run integration tests
    if ! run_test_suite "integration" "integration" 60000; then
        failed_suites+=("integration")
    fi
    
    # Run performance tests
    if ! run_test_suite "performance" "performance" 300000; then
        failed_suites+=("performance")
    fi
    
    # Report results
    if [ ${#failed_suites[@]} -eq 0 ]; then
        print_success "All workflow test suites passed!"
        return 0
    else
        print_error "Failed test suites: ${failed_suites[*]}"
        return 1
    fi
}

# Function to run specific workflow tests
run_specific_tests() {
    local test_file=$1
    
    print_status "Running specific test file: $test_file"
    
    if npm test -- "$test_file"; then
        print_success "Test file $test_file passed"
        return 0
    else
        print_error "Test file $test_file failed"
        return 1
    fi
}

# Main execution logic
case $TEST_TYPE in
    "unit")
        run_test_suite "unit" "unit" 30000
        ;;
    "integration")
        run_test_suite "integration" "integration" 60000
        ;;
    "performance")
        run_test_suite "performance" "performance" 300000
        ;;
    "batch-integration")
        run_specific_tests "src/__tests__/batch-workflow-integration.test.ts"
        ;;
    "continue-integration")
        run_specific_tests "src/__tests__/continue-episode-integration.test.ts"
        ;;
    "load")
        run_specific_tests "src/__tests__/batch-workflow-load.test.ts"
        ;;
    "error-scenarios")
        run_specific_tests "src/__tests__/workflow-error-scenarios.test.ts"
        ;;
    "e2e")
        run_specific_tests "src/__tests__/workflow-endpoints-e2e.test.ts"
        ;;
    "story-performance")
        run_specific_tests "src/__tests__/sequential-story-performance.test.ts"
        ;;
    "all")
        run_all_tests
        ;;
    *)
        print_error "Unknown test type: $TEST_TYPE"
        echo "Available test types:"
        echo "  unit                - Run unit tests only"
        echo "  integration         - Run integration tests only"
        echo "  performance         - Run performance tests only"
        echo "  batch-integration   - Run batch workflow integration tests"
        echo "  continue-integration - Run continue episode integration tests"
        echo "  load                - Run load tests"
        echo "  error-scenarios     - Run error scenario tests"
        echo "  e2e                 - Run end-to-end tests"
        echo "  story-performance   - Run story performance tests"
        echo "  all                 - Run all tests (default)"
        exit 1
        ;;
esac

exit_code=$?

if [ $exit_code -eq 0 ]; then
    print_success "Workflow tests completed successfully!"
else
    print_error "Workflow tests failed!"
fi

exit $exit_code