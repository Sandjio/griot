#!/bin/bash

# Automated Testing Script for CI/CD Pipeline
# This script runs all tests required for deployment validation
# Usage: ./scripts/run-tests.sh [test-type] [environment]

set -e

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Test configuration
TEST_RESULTS_DIR="$PROJECT_ROOT/test-results"
COVERAGE_DIR="$PROJECT_ROOT/coverage"

# Create test results directory
mkdir -p "$TEST_RESULTS_DIR"

# Unit tests
run_unit_tests() {
    log_info "Running unit tests..."
    
    cd "$PROJECT_ROOT"
    
    # Run Jest tests with coverage
    if npm test -- --coverage --ci --watchAll=false --testResultsProcessor=jest-junit; then
        log_success "Unit tests passed"
        
        # Move test results
        if [ -f "junit.xml" ]; then
            mv junit.xml "$TEST_RESULTS_DIR/unit-tests-${TIMESTAMP}.xml"
        fi
        
        return 0
    else
        log_error "Unit tests failed"
        return 1
    fi
}

# CDK infrastructure tests
run_infrastructure_tests() {
    log_info "Running infrastructure tests..."
    
    cd "$PROJECT_ROOT"
    
    # Run CDK tests
    if npm run test; then
        log_success "Infrastructure tests passed"
        return 0
    else
        log_error "Infrastructure tests failed"
        return 1
    fi
}

# CDK synthesis validation
run_cdk_synthesis() {
    local environment=${1:-dev}
    
    log_info "Running CDK synthesis validation for environment: $environment"
    
    cd "$PROJECT_ROOT"
    
    # Build the project
    if ! npm run build; then
        log_error "CDK build failed"
        return 1
    fi
    
    # Synthesize CDK templates
    if npx cdk synth --context environment="$environment" --output="$TEST_RESULTS_DIR/cdk-synth-${environment}-${TIMESTAMP}"; then
        log_success "CDK synthesis completed for $environment"
        
        # Validate CloudFormation templates
        local synth_dir="$TEST_RESULTS_DIR/cdk-synth-${environment}-${TIMESTAMP}"
        
        for template in "$synth_dir"/*.template.json; do
            if [ -f "$template" ]; then
                local template_name=$(basename "$template")
                log_info "Validating CloudFormation template: $template_name"
                
                if aws cloudformation validate-template --template-body "file://$template" > /dev/null 2>&1; then
                    log_success "Template validation passed: $template_name"
                else
                    log_error "Template validation failed: $template_name"
                    return 1
                fi
            fi
        done
        
        return 0
    else
        log_error "CDK synthesis failed for $environment"
        return 1
    fi
}

# Security scanning
run_security_scan() {
    log_info "Running security scan..."
    
    cd "$PROJECT_ROOT"
    
    # Check for known vulnerabilities in dependencies
    if npm audit --audit-level=high; then
        log_success "No high-severity vulnerabilities found"
    else
        log_warning "Security vulnerabilities detected - review npm audit output"
        # Don't fail the build for audit issues in CI, but log them
    fi
    
    # Check for secrets in code (basic check)
    log_info "Scanning for potential secrets..."
    
    local secret_patterns=(
        "password\s*=\s*['\"][^'\"]*['\"]"
        "secret\s*=\s*['\"][^'\"]*['\"]"
        "key\s*=\s*['\"][^'\"]*['\"]"
        "token\s*=\s*['\"][^'\"]*['\"]"
        "AKIA[0-9A-Z]{16}"  # AWS Access Key pattern
    )
    
    local secrets_found=0
    
    for pattern in "${secret_patterns[@]}"; do
        if grep -r -i -E "$pattern" --include="*.ts" --include="*.js" --include="*.json" . --exclude-dir=node_modules --exclude-dir=cdk.out --exclude-dir=coverage; then
            log_warning "Potential secret pattern found: $pattern"
            ((secrets_found++))
        fi
    done
    
    if [ $secrets_found -eq 0 ]; then
        log_success "No obvious secrets found in code"
    else
        log_warning "$secrets_found potential secret patterns found - please review"
    fi
    
    return 0
}

# Linting and code quality
run_code_quality_checks() {
    log_info "Running code quality checks..."
    
    cd "$PROJECT_ROOT"
    
    # TypeScript compilation check
    log_info "Checking TypeScript compilation..."
    if npx tsc --noEmit; then
        log_success "TypeScript compilation check passed"
    else
        log_error "TypeScript compilation errors found"
        return 1
    fi
    
    # ESLint (if configured)
    if [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ]; then
        log_info "Running ESLint..."
        if npx eslint . --ext .ts,.js --format junit --output-file "$TEST_RESULTS_DIR/eslint-${TIMESTAMP}.xml"; then
            log_success "ESLint checks passed"
        else
            log_error "ESLint checks failed"
            return 1
        fi
    fi
    
    # Prettier (if configured)
    if [ -f ".prettierrc" ] || [ -f ".prettierrc.json" ]; then
        log_info "Checking code formatting with Prettier..."
        if npx prettier --check .; then
            log_success "Code formatting check passed"
        else
            log_error "Code formatting issues found - run 'npm run format' to fix"
            return 1
        fi
    fi
    
    return 0
}

# Integration tests (if environment is provided)
run_integration_tests() {
    local environment=$1
    
    if [ -z "$environment" ]; then
        log_info "Skipping integration tests - no environment specified"
        return 0
    fi
    
    log_info "Running integration tests against environment: $environment"
    
    cd "$PROJECT_ROOT"
    
    # Set environment for tests
    export TEST_ENVIRONMENT="$environment"
    
    # Run integration tests (assuming they're tagged appropriately)
    if npm test -- --testNamePattern="integration" --ci --watchAll=false; then
        log_success "Integration tests passed"
        return 0
    else
        log_error "Integration tests failed"
        return 1
    fi
}

# Load testing (basic)
run_load_tests() {
    local environment=$1
    
    if [ -z "$environment" ] || [ "$environment" = "prod" ]; then
        log_info "Skipping load tests - not running against production or no environment specified"
        return 0
    fi
    
    log_info "Running basic load tests against environment: $environment"
    
    # This would typically use tools like Artillery, k6, or JMeter
    # For now, we'll do a basic curl-based test
    
    # Get API endpoint
    local api_endpoint
    api_endpoint=$(aws cloudformation describe-stacks \
        --stack-name "GriotMangaApiStack-${environment}" \
        --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$api_endpoint" ]; then
        log_warning "Could not retrieve API endpoint for load testing"
        return 0
    fi
    
    log_info "Running basic load test against: $api_endpoint"
    
    # Simple concurrent request test
    local concurrent_requests=10
    local total_requests=100
    
    log_info "Sending $total_requests requests with $concurrent_requests concurrent connections..."
    
    # Use curl with xargs for basic load testing
    seq 1 $total_requests | xargs -n1 -P$concurrent_requests -I{} \
        curl -s -o /dev/null -w "%{http_code}\n" \
        --max-time 30 \
        "$api_endpoint/health" > "$TEST_RESULTS_DIR/load-test-${environment}-${TIMESTAMP}.txt"
    
    # Analyze results
    local success_count
    success_count=$(grep -c "200" "$TEST_RESULTS_DIR/load-test-${environment}-${TIMESTAMP}.txt" || echo "0")
    
    local success_rate=$((success_count * 100 / total_requests))
    
    log_info "Load test results: $success_count/$total_requests successful requests ($success_rate%)"
    
    if [ $success_rate -ge 95 ]; then
        log_success "Load test passed (success rate: $success_rate%)"
        return 0
    else
        log_error "Load test failed (success rate: $success_rate% < 95%)"
        return 1
    fi
}

# Generate test report
generate_test_report() {
    log_info "Generating test report..."
    
    local report_file="$TEST_RESULTS_DIR/test-report-${TIMESTAMP}.html"
    
    cat > "$report_file" << EOF
<!DOCTYPE html>
<html>
<head>
    <title>Test Report - ${TIMESTAMP}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background-color: #f0f0f0; padding: 10px; border-radius: 5px; }
        .success { color: green; }
        .error { color: red; }
        .warning { color: orange; }
        .section { margin: 20px 0; padding: 10px; border-left: 3px solid #ccc; }
    </style>
</head>
<body>
    <div class="header">
        <h1>Manga Platform Test Report</h1>
        <p>Generated: ${TIMESTAMP}</p>
        <p>Environment: ${TEST_ENVIRONMENT:-"N/A"}</p>
    </div>
    
    <div class="section">
        <h2>Test Results</h2>
        <p>Test results and artifacts can be found in: $TEST_RESULTS_DIR</p>
        
        <h3>Available Reports:</h3>
        <ul>
EOF
    
    # List available test result files
    for file in "$TEST_RESULTS_DIR"/*; do
        if [ -f "$file" ]; then
            local filename=$(basename "$file")
            echo "            <li>$filename</li>" >> "$report_file"
        fi
    done
    
    cat >> "$report_file" << EOF
        </ul>
    </div>
    
    <div class="section">
        <h2>Coverage Report</h2>
        <p>Code coverage reports can be found in: $COVERAGE_DIR</p>
    </div>
</body>
</html>
EOF
    
    log_success "Test report generated: $report_file"
}

# Main test runner
run_all_tests() {
    local test_type=${1:-all}
    local environment=$2
    
    log_info "Starting test suite: $test_type"
    if [ -n "$environment" ]; then
        log_info "Target environment: $environment"
        export TEST_ENVIRONMENT="$environment"
    fi
    
    local test_start_time=$(date +%s)
    local test_failures=0
    
    # Define test suites
    case $test_type in
        unit)
            local tests=("run_unit_tests")
            ;;
        infrastructure)
            local tests=("run_infrastructure_tests" "run_cdk_synthesis")
            ;;
        quality)
            local tests=("run_code_quality_checks" "run_security_scan")
            ;;
        integration)
            local tests=("run_integration_tests")
            ;;
        load)
            local tests=("run_load_tests")
            ;;
        all)
            local tests=(
                "run_unit_tests"
                "run_infrastructure_tests"
                "run_cdk_synthesis"
                "run_code_quality_checks"
                "run_security_scan"
                "run_integration_tests"
                "run_load_tests"
            )
            ;;
        *)
            log_error "Invalid test type: $test_type"
            log_error "Valid types: unit, infrastructure, quality, integration, load, all"
            exit 1
            ;;
    esac
    
    # Run tests
    for test in "${tests[@]}"; do
        log_info "Running test suite: $test"
        
        if $test "$environment"; then
            log_success "Test suite passed: $test"
        else
            log_error "Test suite failed: $test"
            ((test_failures++))
        fi
        
        echo "---"
    done
    
    # Generate report
    generate_test_report
    
    local test_end_time=$(date +%s)
    local test_duration=$((test_end_time - test_start_time))
    
    # Summary
    log_info "Test Summary:"
    log_info "  Test Type: $test_type"
    log_info "  Environment: ${environment:-"N/A"}"
    log_info "  Duration: ${test_duration}s"
    log_info "  Test Suites Run: ${#tests[@]}"
    log_info "  Failures: $test_failures"
    
    if [ $test_failures -eq 0 ]; then
        log_success "All tests passed!"
        return 0
    else
        log_error "$test_failures test suite(s) failed!"
        return 1
    fi
}

# Script execution
main() {
    local test_type=${1:-all}
    local environment=$2
    
    # Check dependencies
    if ! command -v npm &> /dev/null; then
        log_error "npm is required but not installed"
        exit 1
    fi
    
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI is required but not installed"
        exit 1
    fi
    
    # Check AWS credentials if environment is specified
    if [ -n "$environment" ] && ! aws sts get-caller-identity > /dev/null 2>&1; then
        log_error "AWS credentials not configured or invalid"
        exit 1
    fi
    
    # Run tests
    if run_all_tests "$test_type" "$environment"; then
        log_success "Test execution completed successfully!"
        exit 0
    else
        log_error "Test execution failed!"
        exit 1
    fi
}

# Execute main function if script is run directly
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi